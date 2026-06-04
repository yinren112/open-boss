// harvest.js — Phase 1：批量搜索 → 结构化落盘（只搜索，不拉 JD 详情）。
//
// ★ 为什么不在这里拉详情？
//   job/detail 接口比搜索敏感得多，密集拉会触发 BOSS code=36/37 "账户存在异常"风控冷却，
//   连搜索也跟着被拦。所以详情交给 enrich.js，只对 LLM 初筛后的短名单慢速拉。
//
// 两道机器初筛（0 token，省下 LLM 读 JD 的成本）：
//   1) preFilter   —— config.json 里你自定义的硬排除关键词 / 最低薪资
//   2) listFilter  —— filters.js 的通用坑规则（猎头/不活跃 HR/金融伪装销售/提成信号）
//   通过这两道的岗才落盘交给 LLM，并标好 A/B 档和命中的风险原因。
//
// 搜索列表字段已经很丰富，足够 LLM 做第一轮筛坑：
//   jobName / skills[] / jobLabels / welfareList（"底薪加提成" = 销售信号）/
//   salaryDesc / jobExperience / jobDegree / areaDistrict+businessDistrict（通勤）/
//   brandScaleName / brandStageName / brandIndustry（公司质量）/ bossTitle / bossActiveTimeDesc
//
// 用法:
//   node harvest.js                       按 config.json 关键词全量搜
//   node harvest.js 数据标注 行政助理      只搜指定关键词（覆盖 config.json）
//
// 产出:
//   data/candidates_latest.jsonl          Phase 2 第一轮 LLM 初筛读这个（已含 A/B 档和风险原因）
//   data/candidates_latest.md             人类/LLM 速览（Markdown 格式）
'use strict';

const fs = require('fs');
const path = require('path');
const { CDP, sleep, rnd } = require('./cdp');
const { listFilter } = require('./filters');
const cfg = require('./config').loadConfig();

const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

// 把 config.searchFilters（BOSS 搜索接口的高级筛选：经验/学历/工作类型/商圈/活跃度）
// 合并进搜索参数。下划线开头的注释键跳过。
function buildSearchParams(query, page, overrides = {}) {
  const filters = cfg.searchFilters || {};
  const params = { scene: 1, query, city: cfg.city, page, pageSize: cfg.pageSize, ...overrides };
  for (const [key, value] of Object.entries(filters)) {
    if (key.startsWith('_')) continue;
    if (value !== undefined && value !== null && value !== '') params[key] = value;
  }
  return params;
}

async function search(cdp, query, page, overrides = {}) {
  const params = buildSearchParams(query, page, overrides);
  const expr = `(async()=>{
    const qs=new URLSearchParams(${JSON.stringify(params)}).toString();
    try{
      const r=await fetch('https://www.zhipin.com/wapi/zpgeek/search/joblist.json?'+qs,{
        headers:{'Accept':'application/json, text/plain, */*','x-requested-with':'XMLHttpRequest',
          'Referer':'https://www.zhipin.com/web/geek/jobs?'+qs},
        credentials:'include'});
      const j=await r.json();
      return JSON.stringify({ok:true,code:j.code,message:j.message,jobs:(j.zpData&&j.zpData.jobList)||[]});
    }catch(e){ return JSON.stringify({ok:false,error:String(e)}); }
  })()`;
  return JSON.parse(await cdp.eval(expr));
}

// config 里你自定义的硬过滤（命中岗位名/技能/标签里的硬词，或低于最低薪资 → 直接丢）
function preFilter(job) {
  const r = cfg.preFilter || {};
  const text = [job.jobName, (job.skills || []).join(' '), (job.jobLabels || []).join(' ')].join(' ');
  for (const kw of r.hardExcludeKeywords || []) {
    if (text.includes(kw)) return { drop: true };
  }
  const m = /^(\d+)\s*-\s*\d+\s*[Kk]/.exec(job.salaryDesc || '');
  if (r.minSalaryK && m && parseInt(m[1]) < r.minSalaryK) return { drop: true };
  return { drop: false };
}

(async () => {
  const keywords = process.argv.slice(2).length ? process.argv.slice(2) : cfg.keywords;
  const cdp = new CDP(cfg.cdpPort || 19222);
  const page = await cdp.connectPage();
  console.log(`✅ 已连接页面: ${page.url.slice(0, 60)}`);

  // 探针：确认账号未被频控
  const probe = await cdp.eval(
    `(async()=>{const r=await fetch('https://www.zhipin.com/wapi/zpgeek/search/joblist.json?scene=1&query=%E8%A1%8C%E6%94%BF&city=${cfg.city}&page=1&pageSize=1',{headers:{'x-requested-with':'XMLHttpRequest'},credentials:'include'});const j=await r.json();return j.code;})()`,
  );
  if (probe !== 0) {
    console.error(
      `⛔ BOSS 探针 code=${probe}\n` +
      `  36/37 = 频控冷却。当天停止脚本，改用浏览器手动正常使用 BOSS，不要短时间重跑（反复触发会加重风控甚至封号）。\n` +
      `  其他非0 = 可能未登录，请在 Chrome 里手动登录 BOSS 直聘后再试。`
    );
    cdp.close();
    process.exit(2);
  }
  console.log('✅ BOSS 探针正常 (code=0)\n');

  const seen = new Set();
  const out = [];
  let dropped = 0;
  const dropReasons = {};
  let aborted = false;

  outer:
  for (const kw of keywords) {
    for (let p = 1; p <= cfg.pagesPerKeyword; p++) {
      const r = await search(cdp, kw, p);
      if (!r.ok) { console.log(`  [${kw} p${p}] fetch失败: ${r.error}`); break; }
      if (r.code === 36 || r.code === 37) {
        console.error(`  ⛔ [${kw} p${p}] code=${r.code} 风控触发，停止收割（已得 ${out.length} 条）。当天勿重跑，改用浏览器手动使用 BOSS。`);
        aborted = true;
        break outer;
      }
      if (r.code !== 0) { console.log(`  [${kw} p${p}] code=${r.code} ${r.message || ''} → 跳过该词`); break; }

      const jobs = r.jobs || [];
      if (!jobs.length) break;

      let added = 0;
      for (const j of jobs) {
        const key = (j.encryptJobId || '') + '|' + (j.encryptBossId || '');
        if (seen.has(key)) continue;
        seen.add(key);
        if (preFilter(j).drop) { dropped++; dropReasons['preFilter硬词'] = (dropReasons['preFilter硬词'] || 0) + 1; continue; }
        const review = listFilter(j, { minK: cfg.preFilter && cfg.preFilter.minSalaryK });
        if (review.drop) {
          dropped++;
          const reason = review.reasons[0] || 'listFilter';
          dropReasons[reason] = (dropReasons[reason] || 0) + 1;
          continue;
        }
        out.push({
          encryptBossId: j.encryptBossId,
          securityId: j.securityId,
          encryptJobId: j.encryptJobId,
          lid: j.lid || '',
          jobName: j.jobName,
          salaryDesc: j.salaryDesc,
          jobExperience: j.jobExperience,
          jobDegree: j.jobDegree,
          skills: j.skills || [],
          jobLabels: j.jobLabels || [],
          welfareList: j.welfareList || [],
          brandName: j.brandName,
          brandScaleName: j.brandScaleName,
          brandStageName: j.brandStageName,
          brandIndustry: j.brandIndustry,
          cityName: j.cityName,
          areaDistrict: j.areaDistrict,
          businessDistrict: j.businessDistrict,
          gps: j.gps || null,
          bossName: j.bossName,
          bossTitle: j.bossTitle,
          bossOnline: !!j.bossOnline,
          bossActiveTimeDesc: j.bossActiveTimeDesc || j.activeTimeDesc || '',
          query: kw,
          listGrade: review.grade,
          listReasons: review.reasons,
        });
        added++;
      }
      console.log(`  [${kw} p${p}] 返回 ${jobs.length}，新增 ${added}`);
      await sleep(rnd(cfg.searchIntervalMs[0], cfg.searchIntervalMs[1]));
    }
  }

  // A 档（无降级信号）排在 B 档前面，方便 LLM 优先看高质量岗
  out.sort((a, b) => (a.listGrade === b.listGrade ? 0 : a.listGrade === 'A' ? -1 : 1));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonl = out.map(o => JSON.stringify(o)).join('\n');
  fs.writeFileSync(path.join(DATA, `candidates_${stamp}.jsonl`), jsonl);
  fs.writeFileSync(path.join(DATA, 'candidates_latest.jsonl'), jsonl);

  // 生成可读 Markdown
  const md = [
    '# 候选岗位（Phase 1 收割·仅搜索）', '',
    `城市：${cfg.cityName}　${out.length} 个（预筛掉 ${dropped}）　${stamp}${aborted ? '　[风控提前中止]' : ''}`,
    '',
  ];
  const dropSummary = Object.entries(dropReasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('；');
  if (dropSummary) md.push(`过滤原因：${dropSummary}`, '');
  out.forEach((o, i) => {
    md.push(`## ${i + 1}. [${o.listGrade || '-'}] ${o.jobName} @ ${o.brandName}`);
    md.push(`- 薪资 ${o.salaryDesc}｜经验 ${o.jobExperience}｜学历 ${o.jobDegree}｜${o.cityName}${o.areaDistrict}${o.businessDistrict}`);
    md.push(`- 公司：${o.brandScaleName}｜${o.brandStageName}｜${o.brandIndustry}　福利：${(o.welfareList || []).join('/')}`);
    if ((o.listReasons || []).length) md.push(`- ⚠️ 降级信号：${o.listReasons.join('/')}`);
    md.push(`- 技能标签：${(o.skills || []).slice(0, 10).join('/')}`);
    md.push(`- HR：${o.bossName} ${o.bossTitle}｜${o.bossOnline ? '当前在线' : '不在线'}${o.bossActiveTimeDesc ? '｜活跃：' + o.bossActiveTimeDesc : ''}｜命中词：${o.query}｜bossId：\`${o.encryptBossId}\``);
    md.push('');
  });
  fs.writeFileSync(path.join(DATA, 'candidates_latest.md'), md.join('\n'));

  console.log(`\n✅ 落盘 ${out.length} 个候选（预筛掉 ${dropped}）${aborted ? ' [风控中止]' : ''}`);
  if (dropSummary) console.log(`   过滤原因：${dropSummary}`);
  console.log(`   data/candidates_latest.jsonl  ← 交给 LLM 做 Phase 2 初筛`);
  console.log(`   下一步：LLM 初筛 → 写 data/shortlist.json → node enrich.js`);
  cdp.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
