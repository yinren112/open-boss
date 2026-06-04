// send.js — Phase 3：对 LLM 通过并写好开场白的岗位，逐个 greet + 发定制开场白。
//
// 设计要点（均来自实测）:
//   1. greet 用 API (friend/add)，看 code=0 即成功，不靠截图。
//   2. ★ 发送一律新开标签页：旧标签（带 _security_check、被反复导航过）进聊天会被弹回首页；
//      新标签稳定不跳。openTab() 已封装。
//   3. URL 直接携带 encryptBossId，Chrome 打开聊天页即选中目标对话。
//   4. ★ 发送前校验对话头部匹配目标 HR/公司名——不匹配就跳过，防发错人。
//   5. ★ 真·聊天框是 contenteditable 的 div.chat-input（不是 AI筛选面板的 textarea.input）。
//      必须用 CDP 原生 Input.insertText 填文字，才触发可信事件让 Vue 解禁发送按钮。
//      execCommand/直接赋值只改 DOM，Vue 不认，btn-send 一直 disabled。
//   6. 默认 DRY-RUN：只选对话+校验头部+探测输入框，不填不发。加 --send 才真发。
//   7. 每条 18-38s 间隔；遇 code=36/37 立即停（风控）。
//
// 输入: data/approved.json
//   每项含: { encryptBossId, securityId, encryptJobId, lid, jobName, brandName, bossName, opening }
//   → 参考 prompts/02_final_filter_and_draft.md 了解如何让 LLM 生成这个文件。
//   → 参考 data/approved.example.json 了解格式。
//
// 用法:
//   node send.js                    DRY-RUN（先跑：确认能选中对话、输入框能否出现）
//   node send.js --send             真实发送（保持 BOSS Chrome 窗口前台可见）
//   node send.js --send --deliver-only  跳过 greet（会话已打过招呼时用），只发开场白
'use strict';

const fs = require('fs');
const path = require('path');
const { CDP, openTab, closeTab, sleep, rnd } = require('./cdp');
const cfg = require('./config').loadConfig();

const DATA = path.join(__dirname, 'data');
const DRY = !process.argv.includes('--send');
const NO_GREET = process.argv.includes('--deliver-only');
const PORT = cfg.cdpPort || 19222;

// greet 走已有标签的 API fetch（fetch 不受页面重定向影响）
async function greet(cdp, job) {
  const expr = `(async()=>{
    const qs=new URLSearchParams({securityId:${JSON.stringify(job.securityId)},jobId:${JSON.stringify(job.encryptJobId)},lid:${JSON.stringify(job.lid || '')},_:Date.now()}).toString();
    try{
      const r=await fetch('https://www.zhipin.com/wapi/zpgeek/friend/add.json?'+qs,{method:'POST',
        headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded','x-requested-with':'XMLHttpRequest','Origin':'https://www.zhipin.com','Referer':'https://www.zhipin.com/web/geek/jobs'},
        body:'sessionId=',credentials:'include'});
      const j=await r.json(); return JSON.stringify({code:j.code,message:j.message});
    }catch(e){ return JSON.stringify({code:-1,error:String(e)}); }
  })()`;
  return JSON.parse(await cdp.eval(expr));
}

// 在新标签里：URL 选对话 → 校验头部 → 定位输入框 →（真发时）CDP原生点击+插文+点发送
async function deliver(job, dry) {
  const tab = await openTab(`https://www.zhipin.com/web/geek/chat?id=${job.encryptBossId}`, PORT);
  try {
    await sleep(7000); // 等聊天 SPA + WebSocket 列表加载
    const name = (job.bossName || '').slice(0, 6);
    const brand = (job.brandName || '').slice(0, 6);

    // 1) 校验对话头部 + 定位真聊天输入框坐标
    const selRaw = await cdp_eval(tab, `(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const header=((document.querySelector('[class*=title-box],.name-box,.chat-title')||{}).innerText||'').replace(/\\s+/g,'');
      const nameOk=${JSON.stringify(name)}&&header.indexOf(${JSON.stringify(name)})>-1;
      const brandOk=${JSON.stringify(brand)}&&header.indexOf(${JSON.stringify(brand)})>-1;
      if(!(nameOk||brandOk)) return JSON.stringify({ok:false,stage:'verify',error:'头部不匹配',header:header.slice(0,24)});
      let ce=null; for(let i=0;i<16;i++){ ce=document.querySelector('.chat-editor .chat-input, div.chat-input[contenteditable]'); if(ce&&ce.offsetParent)break; await wait(500); }
      if(!ce||!ce.offsetParent) return JSON.stringify({ok:false,stage:'composer',error:'聊天输入框(.chat-input)未出现',header:header.slice(0,24)});
      const r=ce.getBoundingClientRect();
      return JSON.stringify({ok:true,header:header.slice(0,24),x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
    })()`);

    if (selRaw === undefined) return { ok: false, stage: 'eval', error: 'eval 返回空，重试该条' };
    const s = JSON.parse(selRaw);
    if (!s.ok) return s;
    if (dry) return { ok: true, stage: 'dry', header: s.header };

    // 2) CDP 原生：点击输入框聚焦 → 插入开场白（触发可信事件，Vue 解禁发送键）
    await tab._cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1 });
    await tab._cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1 });
    await sleep(400);
    await tab._cmd('Input.insertText', { text: job.opening });
    await sleep(700);

    // 3) 校验填入 + 点发送键，校验已清空（= 已发出）
    const sentRaw = await cdp_eval(tab, `(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const ce=document.querySelector('.chat-editor .chat-input, div.chat-input[contenteditable]');
      const filled=ce&&(ce.innerText||ce.textContent||'').replace(/\\s+/g,'').length>0;
      if(!filled) return JSON.stringify({ok:false,stage:'fill',error:'文本未填入'});
      let btn=document.querySelector('button.btn-send:not(.disabled), a.btn-send:not(.disabled)');
      let method;
      if(btn){ btn.click(); method='click'; }
      else { ce.focus(); for(const ty of ['keydown','keypress','keyup']) ce.dispatchEvent(new KeyboardEvent(ty,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true})); method='enter'; }
      await wait(1100);
      const now=document.querySelector('.chat-editor .chat-input, div.chat-input[contenteditable]');
      const cleared=!now||(now.innerText||now.textContent||'').replace(/\\s+/g,'')==='';
      return JSON.stringify({ok:cleared,stage:'sent',method,filled,cleared});
    })()`);

    if (sentRaw === undefined) return { ok: false, stage: 'eval', error: '发送阶段 eval 返回空', header: s.header };
    return { ...JSON.parse(sentRaw), header: s.header };
  } finally {
    await closeTab(tab.tabId, PORT);
    tab.close();
  }
}

// openTab 返回的 CDP 实例已连好 ws，直接 eval
function cdp_eval(tab, expr) { return tab.eval(expr, 25000); }

(async () => {
  const file = process.argv.find(a => a.endsWith('.json') && !a.includes('node')) || path.join(DATA, 'approved.json');
  if (!fs.existsSync(file)) {
    console.error(
      `找不到 ${file}\n` +
      `  需要 LLM 终筛后生成的 approved.json（含 opening 字段）\n` +
      `  → 参考 prompts/02_final_filter_and_draft.md\n` +
      `  → 参考 data/approved.example.json 了解格式`
    );
    process.exit(1);
  }

  const list = JSON.parse(fs.readFileSync(file, 'utf-8'));
  console.log(`读到 ${list.length} 个待发　模式：${DRY ? 'DRY-RUN（选对话+校验+探输入框，不发）' : '★真实发送'}`);
  if (!DRY) {
    console.log('⚠️  真实发送：请确认 BOSS Chrome 窗口在屏幕前台可见（输入框需要前台才展开）。\n');
  }

  const apiCdp = new CDP(PORT);
  await apiCdp.connectPage();

  const log = [];
  let okN = 0;

  for (let i = 0; i < list.length; i++) {
    const j = list[i];
    if (!j.opening || !j.encryptBossId || !j.securityId || !j.encryptJobId) {
      console.log(`  [${i + 1}] 跳过：缺必要字段 (${j.jobName || '?'})`);
      log.push({ job: j.jobName, ok: false, reason: 'missing fields' });
      continue;
    }

    process.stdout.write(`  [${i + 1}/${list.length}] ${j.jobName} @ ${j.brandName || ''}　`);

    if (!DRY && !NO_GREET) {
      const g = await greet(apiCdp, j);
      if (g.code === 36 || g.code === 37) {
        console.log(`⛔ greet code=${g.code} 风控，停止。当天勿重跑脚本，改用浏览器手动使用 BOSS，待账号恢复正常后再继续。`);
        log.push({ job: j.jobName, ok: false, stage: 'greet', code: g.code });
        break;
      }
      if (g.code !== 0 && g.code !== 1) {
        console.log(`greet code=${g.code} ${g.message || ''}，跳过`);
        log.push({ job: j.jobName, ok: false, stage: 'greet', code: g.code });
        await sleep(rnd(cfg.sendIntervalMs[0], cfg.sendIntervalMs[1]));
        continue;
      }
      await sleep(rnd(1500, 3000));
    }

    const d = await deliver(j, DRY);
    if (d.ok) okN++;
    console.log(
      d.ok
        ? (DRY ? `✅ 对话已选中+输入框就绪 (${d.header})` : `✅ 已发送 (${d.method})`)
        : `⚠️  ${d.stage}: ${d.error || ''} ${d.header || ''}`
    );
    log.push({ job: j.jobName, boss: j.encryptBossId, dry: DRY, ...d });
    fs.writeFileSync(path.join(DATA, 'send_log.jsonl'), log.map(x => JSON.stringify(x)).join('\n'));

    if (i < list.length - 1) {
      await sleep(DRY ? rnd(1500, 3000) : rnd(cfg.sendIntervalMs[0], cfg.sendIntervalMs[1]));
    }
  }

  apiCdp.close();
  console.log(`\n${DRY ? 'DRY-RUN' : '发送'}完成：✅ ${okN} / ${list.length}　日志 data/send_log.jsonl`);
  if (DRY) {
    console.log('若都 ✅，加 --send 参数真实发送（保持 BOSS 窗口前台可见）。');
    console.log('若多为 stage:composer，检查 Chrome 窗口是否在前台，以及 encryptBossId 是否正确。');
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
