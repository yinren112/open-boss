// cdp.js — 通过 CDP 协议直接驱动已登录 BOSS 直聘的本机 Chrome。
//
// 前置条件：Chrome 已打开并登录 BOSS 直聘，且以 --remote-debugging-port=<port> 启动。
// 启动示例（见 README 的"启动 Chrome"一节）。
//
// 设计说明：
//   直连已登录页面，借用页面的真实 cookie/TLS 在页面内 fetch，不触发反爬。
//   不依赖外部框架（Puppeteer / Playwright），仅用 Node 内置 http 和 ws 库。
//   实测下来，CDP 直连同一个已登录页面比任何外部 poller 通道都稳定、秒回。
'use strict';

const WebSocket = require('ws');
const http = require('http');

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDP {
  constructor(port = 19222) {
    this.port = port;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
  }

  /**
   * 连接到当前已打开的目标站点页面（复用已有登录态，不新建标签）。
   * @param {string|function} [match='zhipin.com'] - 字符串走 url.includes()，函数走 t=>bool（多平台扩展用）。
   * 若未找到匹配页面，抛出错误并提示用户先手动打开。
   */
  async connectPage(match = 'zhipin.com') {
    const tabs = await httpJson(`http://127.0.0.1:${this.port}/json`);
    const test = typeof match === 'function' ? match : (t => (t.url || '').includes(match));
    const page = tabs.find(t => t.type === 'page' && test(t));
    if (!page) {
      throw new Error(
        `未找到匹配的已打开页面（match=${typeof match === 'function' ? 'fn' : match}）。\n` +
        '请确认：\n' +
        '  1. Chrome 已以 --remote-debugging-port=' + this.port + ' 启动（见 README）\n' +
        '  2. Chrome 里已打开并登录 BOSS 直聘（zhipin.com）'
      );
    }
    await new Promise((res, rej) => {
      this.ws = new WebSocket(page.webSocketDebuggerUrl);
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', m => {
        const msg = JSON.parse(m);
        const cb = this.pending.get(msg.id);
        if (cb) { this.pending.delete(msg.id); cb(msg); }
      });
    });
    this.page = page;
    return page;
  }

  _cmd(method, params) {
    return new Promise(resolve => {
      const id = ++this.id;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * 在页面内执行一段 JS 表达式（支持 await Promise）。
   * @param {string} expr - 要执行的 JS 表达式
   * @param {number} [timeoutMs=25000] - 超时毫秒数
   * @returns {Promise<any>} 表达式的返回值（returnByValue）
   */
  async eval(expr, timeoutMs = 25000) {
    const cmd = this._cmd('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('CDP eval timeout')), timeoutMs)
    );
    const msg = await Promise.race([cmd, timeout]);
    if (msg.result && msg.result.exceptionDetails) {
      throw new Error('JS 异常: ' + JSON.stringify(msg.result.exceptionDetails).slice(0, 300));
    }
    return msg.result && msg.result.result ? msg.result.result.value : undefined;
  }

  /** 页面内导航（不需要 enable Page 域）*/
  async navigate(url) {
    await this.eval(`location.href=${JSON.stringify(url)};'ok'`);
  }

  close() {
    try { this.ws && this.ws.close(); } catch (e) {}
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// rnd: 返回 [a,b] 区间内的随机延迟。用 Bates(n=3)——3 个均匀随机取平均——
// 得到一个有界、居中的钟形分布。比均匀随机更接近人类停顿，也避免“延迟均匀分布”
// 本身成为可被风控识别的时间签名（固定/均匀间隔有可识别的 temporal signature）。
// 区间端点仍可能取到，所以不会把所有延迟挤成同一个值。
const rnd = (a, b) => {
  const u = (Math.random() + Math.random() + Math.random()) / 3; // 0..1，集中在 0.5
  let v = a + (b - a) * u;
  // 5% 概率“犹豫”：偶发额外停 2-5s，给延迟加长尾（人类会走神，不会每次都精确停顿）。
  if (Math.random() < 0.05) v += 2000 + Math.random() * 3000;
  return v;
};

// ── 浏览器级标签管理（HTTP，不需要 WebSocket）──
//
// 实测：被反复导航过、带 _security_check 的旧标签页进聊天会被弹回首页。
// 解决：发送消息时一律新开标签页，稳定不跳。
function _http(method, path, port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method },
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * 新开一个 Chrome 标签页并返回已连接的 CDP 实例。
 * @param {string} url - 标签页初始 URL
 * @param {number} [port=19222] - CDP 调试端口
 * @returns {Promise<CDP>} 已连接该标签的 CDP 实例（含 .tabId）
 */
async function openTab(url, port = 19222) {
  const raw = await _http('PUT', '/json/new?' + encodeURIComponent(url), port);
  const tab = JSON.parse(raw);
  await _http('GET', '/json/activate/' + tab.id, port).catch(() => {}); // 尽量前台
  const cdp = new CDP(port);
  await new Promise((res, rej) => {
    cdp.ws = new WebSocket(tab.webSocketDebuggerUrl);
    cdp.ws.on('open', res);
    cdp.ws.on('error', rej);
    cdp.ws.on('message', m => {
      const msg = JSON.parse(m);
      const cb = cdp.pending.get(msg.id);
      if (cb) { cdp.pending.delete(msg.id); cb(msg); }
    });
  });
  cdp.tabId = tab.id;
  return cdp;
}

/** 关闭指定标签页 */
function closeTab(tabId, port = 19222) {
  return _http('GET', '/json/close/' + tabId, port).catch(() => {});
}

/**
 * 连到已打开的匹配页面；若一个都没有，则自动新开 fallbackUrl 页面并连上。
 * 省掉“必须先手动开好某站点页面”的前置麻烦。
 * @returns {Promise<{cdp: CDP, opened: boolean}>} opened=true 表示是脚本新开的标签，调用方可决定是否收尾 closeTab。
 */
async function connectOrOpen(match, fallbackUrl, port = 19222) {
  const tabs = await httpJson(`http://127.0.0.1:${port}/json`);
  const test = typeof match === 'function' ? match : (t => (t.url || '').includes(match));
  if (tabs.find(t => t.type === 'page' && test(t))) {
    const cdp = new CDP(port);
    await cdp.connectPage(match);
    return { cdp, opened: false };
  }
  const cdp = await openTab(fallbackUrl, port);
  return { cdp, opened: true };
}

module.exports = { CDP, httpJson, sleep, rnd, openTab, closeTab, connectOrOpen };
