// enrich.js — Phase 1.5：只对 LLM 初筛出的短名单慢速读取 JD 详情。
//
// ★ 默认走"打开详情页读 DOM"，不走内部接口。
//   实测：内部 job/detail 接口比真实浏览敏感得多，密集请求会触发 BOSS code=36/37 风控冷却。
//   打开详情页、从页面 DOM 读 JD 更接近用户真实浏览，更安全。内部 API 仅作 `--api` 备用。
//   无论哪种方式都要慢：只对短名单（默认 ≤20 个）拉，一旦遇到风控/验证信号立即停。
//
// 读到 JD 后自动跑 filters.jdTrap，标出培训贷/产线工/伪装销售/保险增员等只有详情才暴露的坑，
// 写进产出文件，LLM 终筛时可直接参考（被标记的不一定枪毙，但要重点审）。
//
// 输入: data/shortlist.json
//   LLM 第一轮初筛后写出的数组，每项至少含：
//   { encryptBossId, securityId, encryptJobId, lid, jobName, brandName }
//   （直接从 candidates_latest.jsonl 里挑出通过初筛的整条对象即可）
//   → 参考 prompts/01_initial_filter.md 了解如何让 LLM 生成这个文件。
//
// 用法:
//   node enrich.js                         读 data/shortlist.json（默认：打开详情页读 DOM）
//   node enrich.js path/to/shortlist.json  指定自定义路径
//   node enrich.js --limit=1               小批量验证，只读前 N 条
//   node enrich.js --fast-page             更紧凑的真实渲染节奏（仍是读 DOM，间隔更短）
//   node enrich.js --api                   备用：走内部 detail API（更容易触发风控）
//
// 产出:
//   data/enriched_latest.jsonl   带 postDescription/address/jdTraps，供 Phase 2 终筛+写开场白
//   data/enriched_latest.md      人类/LLM 速览（已标出 JD 命中的坑）
'use strict';

const fs = require('fs');
const path = require('path');
const { CDP, openTab, closeTab, sleep, rnd } = require('./cdp');
const { jdTrap } = require('./filters');
const cfg = require('./config').loadConfig();

const DATA = path.join(__dirname, 'data');
const USE_API = process.argv.includes('--api');
const FAST_PAGE = process.argv.includes('--fast-page');
const LIMIT_ARG = process.argv.find(a => /^--limit=\d+$/.test(a));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : null;

// 备用路径：内部 detail 接口。更快但更敏感，仅 --api 时用。
async function detailByApi(cdp, job) {
  const expr = `(async()=>{
    const dqs=new URLSearchParams({securityId:${JSON.stringify(job.securityId)},lid:${JSON.stringify(job.lid || '')},sessionId:''}).toString();
    try{
      const r=await fetch('https://www.zhipin.com/wapi/zpgeek/job/detail.json?'+dqs,{
        headers:{'Accept':'application/json','x-requested-with':'XMLHttpRequest',
          'Referer':'https://www.zhipin.com/job_detail/'+${JSON.stringify(job.encryptJobId)}+'.html'},
        credentials:'include'});
      const j=await r.json(); const zp=j.zpData||{}; const ji=zp.jobInfo||{};
      return JSON.stringify({code:j.code,message:j.message,
        postDescription:ji.postDescription||'', address:ji.address||''});
    }catch(e){ return JSON.stringify({code:-1,error:String(e)}); }
  })()`;
  return JSON.parse(await cdp.eval(expr));
}

// 默认路径：打开岗位详情页，轮询页面 DOM 直到 JD 文本就绪或出现验证/风控提示。
async function detailByPage(job) {
  const url = `https://www.zhipin.com/job_detail/${job.encryptJobId}.html?lid=${encodeURIComponent(job.lid || '')}&securityId=${encodeURIComponent(job.securityId || '')}`;
  const tab = await openTab(url, cfg.cdpPort || 19222);
  try {
    const initialWait = cfg.enrichPageInitialWaitMs || 1200;
    const readyTimeout = cfg.enrichPageReadyTimeoutMs || 8000;
    const pollMs = cfg.enrichPagePollMs || 250;
    await sleep(initialWait);
    const probeExpr = `JSON.stringify((()=>{
      const txt = document.body ? document.body.innerText : '';
      const bad = /安全验证|环境异常|登录后继续|请完成验证|访问过于频繁|当前访问行为异常/.test(txt.slice(0, 3000));
      const descEl = document.querySelector('.job-sec-text,.job-detail-section .text,.job-detail-box .desc,.job-detail-box');
      const addressEl = document.querySelector('.location-address,.job-address,.job-location,.job-detail-location');
      const postDescription = descEl ? (descEl.innerText || '').trim() : '';
      const address = addressEl ? (addressEl.innerText || '').trim() : '';
      return {bad, ready: !!postDescription, postDescription, address, href: location.href, title: document.title};
    })())`;

    let snap = null;
    const started = Date.now();
    while (Date.now() - started <= readyTimeout) {
      snap = JSON.parse(await tab.eval(probeExpr, 12000));
      if (snap.bad || snap.ready) break;
      await sleep(pollMs);
    }
    return {
      code: snap && snap.bad ? 37 : 0,
      message: snap && snap.bad ? 'page risk/verify text detected' : 'Success',
      postDescription: snap ? snap.postDescription : '',
      address: snap ? snap.address : '',
      _waitMs: Date.now() - started + initialWait,
    };
  } finally {
    await closeTab(tab.tabId, cfg.cdpPort || 19222);
    tab.close();
  }
}

(async () => {
  const fileArg = process.argv.slice(2).find(a => !a.startsWith('--'));
  const file = fileArg || path.join(DATA, 'shortlist.json');
  if (!fs.existsSync(file)) {
    console.error(
      `找不到短名单 ${file}\n` +
      `  先让 LLM 在 candidates_latest.jsonl 上初筛，挑出通过的整条对象，写成数组存到 data/shortlist.json\n` +
      `  → 参考 prompts/01_initial_filter.md`
    );
    process.exit(1);
  }

  let list = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(list)) { console.error('shortlist.json 必须是数组'); process.exit(1); }

  if (LIMIT && list.length > LIMIT) {
    console.log(`--limit=${LIMIT}，只取前 ${LIMIT} 个做小批量验证`);
    list = list.slice(0, LIMIT);
  }
  if (list.length > cfg.enrichMax) {
    console.log(`短名单 ${list.length} 个，超过 enrichMax=${cfg.enrichMax}，只取前 ${cfg.enrichMax} 个（避免风控）`);
    list = list.slice(0, cfg.enrichMax);
  }

  const cdp = new CDP(cfg.cdpPort || 19222);
  await cdp.connectPage();
  const interval = USE_API
    ? cfg.enrichDetailIntervalMs
    : (FAST_PAGE ? (cfg.enrichPageFastIntervalMs || cfg.enrichPageIntervalMs) : (cfg.enrichPageIntervalMs || cfg.enrichDetailIntervalMs));
  const mode = USE_API ? 'API备用' : (FAST_PAGE ? '页面DOM加速' : '页面DOM默认');
  console.log(`✅ 已连接页面，准备给 ${list.length} 个短名单读取 JD（${mode}，间隔 ${interval[0]}-${interval[1]}ms）\n`);

  const out = [];
  let aborted = false;

  for (let i = 0; i < list.length; i++) {
    const j = list[i];
    if (!j.securityId || !j.encryptJobId) {
      console.log(`  [${i + 1}] 跳过：缺 securityId/jobId (${j.jobName || '?'})`);
      continue;
    }

    const d = USE_API ? await detailByApi(cdp, j) : await detailByPage(j);

    if (d.code === 36 || d.code === 37) {
      console.error(
        `  ⛔ [${i + 1}] code=${d.code} 风控/验证信号，立即停止（已读 ${out.length} 条）。\n` +
        `  ★当天不要重跑脚本，改用浏览器手动正常使用 BOSS。账号恢复正常后再续跑剩余\n` +
        `  （把已成功的从 shortlist 里去掉，从断点继续；已读到的结果已落盘，不会丢）。`
      );
      aborted = true;
      break;
    }

    const jd = d.code === 0 ? d.postDescription : '';
    const traps = jd ? jdTrap(jd) : [];
    out.push({
      ...j,
      postDescription: jd,
      address: d.code === 0 ? d.address : '',
      jdTraps: traps,
      _detailCode: d.code,
      _detailWaitMs: d._waitMs || null,
    });
    console.log(`  [${i + 1}/${list.length}] ${j.jobName} @ ${j.brandName || ''} ${d.code === 0 ? '✅' : '⚠️ code=' + d.code}${traps.length ? ' ⚠️坑:' + traps.join('/') : ''}`);

    if (i < list.length - 1) {
      await sleep(rnd(interval[0], interval[1]));
    }
  }

  const jsonl = out.map(o => JSON.stringify(o)).join('\n');
  fs.writeFileSync(path.join(DATA, 'enriched_latest.jsonl'), jsonl);

  const md = ['# 短名单 + JD 详情（Phase 1.5）', '', `${out.length} 个${aborted ? '　[风控提前中止]' : ''}`, ''];
  out.forEach((o, i) => {
    md.push(`## ${i + 1}. ${o.jobName} @ ${o.brandName || ''}`);
    md.push(`- 薪资 ${o.salaryDesc || ''}｜${o.areaDistrict || ''}${o.businessDistrict || ''}｜地址：${o.address || '(无)'}`);
    if ((o.jdTraps || []).length) md.push(`- 🚩 JD 命中坑：${o.jdTraps.join('/')}（LLM 终筛重点审）`);
    md.push(`- bossId：\`${o.encryptBossId}\``);
    md.push(`- JD：${(o.postDescription || '(详情拉取失败)').replace(/\n+/g, ' ').slice(0, 400)}`);
    md.push('');
  });
  fs.writeFileSync(path.join(DATA, 'enriched_latest.md'), md.join('\n'));

  console.log(`\n✅ 落盘 ${out.length} 条带 JD${aborted ? ' [风控中止]' : ''}`);
  console.log(`   data/enriched_latest.jsonl  ← 交给 LLM 做 Phase 2 终筛 + 逐条写开场白`);
  console.log(`   下一步：LLM 终筛+写稿 → data/approved.json → node send.js`);
  console.log(`   → 参考 prompts/02_final_filter_and_draft.md`);
  cdp.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
