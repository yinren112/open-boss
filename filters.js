// filters.js — 零 token 的“先过机器、再过人”过滤层。
// 目的：把垃圾/坑/不活跃岗在【脚本阶段】就剔掉，LLM 只看通过机器初筛的少量岗，
// 从而省下读 JD / 写开场白的 token。规则借鉴了几个开源项目的经验：
// get_jobs 的黑名单/不活跃 HR/猎头过滤、geekgeekrun 的本地黑名单、boss_batch_push 的活跃过滤。
//
// 两级：
//   listFilter(job)  —— 只用【搜索列表字段】判，0 网络/0 token。harvest 阶段调用。
//   jdTrap(text)     —— 对【已抓到的 JD 文本】跑正则，自动标记明显坑，剩下的才交给 LLM。
'use strict';

// 活跃度白名单：BOSS 搜索接口字段 bossActiveTimeDesc。只留最近活跃的 HR。
const ACTIVE_OK = ['刚刚活跃', '今日活跃', '3日内活跃', '本周活跃', '7日内活跃'];
// 容忍（次优，降级但不直接杀）：近 1 月活跃；更久的直接淘汰。
const ACTIVE_MEH = ['近1月活跃', '本月活跃', '近一月活跃'];

// 公司/行业黑名单（伪装销售/增员高发区）。命中“行业/公司名 + 岗位名是文职”才杀，避免误伤真行政。
const TRAP_INDUSTRY = ['互联网金融', '投资', '融资', '担保', '银行', '证券', '信托', '基金', '保险', '小额贷', '典当'];
const TRAP_BRAND = ['人寿', '财产保险', '养老保险', '太平洋保险', '平安', '保险代理', '保险经纪'];

// 岗位名/标签里的销售/客服/坑信号
const TRAP_TITLE = [
  /销售|电销|网销|客服|外呼|话务|邀约|催收|续费|信审|风控专员|理财顾问|客户经理|业务员|顾问/,
  /主播|带货|直播|网红|经纪人|红果|短剧|探店/,
  /\b(无责底薪|永久无责|高提成|底薪\+提成|日入|月入过万|今天面试|明天上班)\b/,
];
// 福利标签里的强销售信号
const TRAP_WELFARE = /底薪加提成|开单提成|高提成|绩效提成/;
// 列表技能标签里的销售信号
const TRAP_SKILL = /电话销售|网络销售|渠道开发|客户拓展|陌拜|地推/;

// JD 正文里只有详情页才暴露的坑
const JD_TRAPS = [
  { tag: '培训贷/刷单', re: /免费学|包教包会|日入\s*\d{3,}|每天\s*\d\s*小时空闲|刷单|做任务返佣|交押金|培训费|服装费|建档费/ },
  { tag: '产线工伪装文员', re: /两班倒|两班制|三班倒|倒班|每天\s*1[0-2]\s*小时|每月\s*2[6-9]\s*天|夜班补贴|计件|车间|流水线|普工/ },
  { tag: '形象/身高门槛', re: /身高\s*1[5-7]\d|形象气质|形象佳|形象好|气质佳|全身.*照|生活照|颜值/ },
  { tag: '伪装销售/电销', re: /无责底薪|无责.{0,3}提成|高提成|底薪\+提成|提成|业绩考核|开单|邀约客户|拓展客户|线上沟通回复|了解客户资质|客户资源/ },
  { tag: '保险增员', re: /增员|组建团队|招募.*伙伴|筛选人才|储备干部.*保险|老客户资料/ },
  { tag: '假双休真单休', re: /单休|大小周|做六休一|月休\s*[1-4]\s*天|排休.*单休/ },
  { tag: '招聘人头计件/超低底薪', re: /(到面|入职|试岗|人头).{0,8}\d+\s*元\/(个|人)|\d+\s*元\/(个|人)|底薪\s*3[0-2]\d\d.*全勤/ },
];

function parseSalaryK(s) {
  const m = /(\d+)\s*-\s*(\d+)\s*[Kk]/.exec(s || '');
  if (m) return [+m[1], +m[2]];
  if (/元\/天|元\/时|元\/月|\d+-\d+元/.test(s || '')) return [-1, -1]; // 计件/兼职，标记
  return [0, 0];
}

// 判断岗位名是否“文职”，用于金融行业的伪装销售识别。
// 默认覆盖行政/文员系；如果你找的不是文职岗，可在 harvest 调用时通过 opt.clericalRe 覆盖。
const DEFAULT_CLERICAL = /文员|助理|办公室|内勤|坐班|专员|后台|前台/;

// —— 列表级初筛：返回 {drop, grade, reasons[]} ——
function listFilter(job, opt = {}) {
  const reasons = [];
  const name = job.jobName || '';
  const ind = job.brandIndustry || '';
  const brand = job.brandName || '';
  const welfare = (job.welfareList || []).join(' ');
  const skills = (job.skills || []).join(' ');
  const active = job.bossActiveTimeDesc || job.activeTimeDesc || '';
  const clericalRe = opt.clericalRe || DEFAULT_CLERICAL;
  let drop = false, demote = false;

  // 1) 猎头/代招
  if (job.proxyJob === 1 || job.proxyJob === '1' || /猎头/.test(brand)) { drop = true; reasons.push('猎头代招'); }

  // 2) 活跃度（有该字段才判；没有则跳过）
  if (active) {
    if (ACTIVE_OK.some(a => active.includes(a))) { /* ok */ }
    else if (ACTIVE_MEH.some(a => active.includes(a))) demote = true;
    else { drop = true; reasons.push('Boss不活跃:' + active); }
  }

  // 3) 伪装销售：金融类行业 或 公司名带金融词 + 文职名
  const isClerical = clericalRe.test(name);
  if (TRAP_INDUSTRY.some(t => ind.includes(t)) && isClerical) { drop = true; reasons.push('金融行业“文职”·疑似电销/增员'); }
  if (/投资|担保|基金|证券|小额贷|小贷|典当|资本|财富|金融|信贷/.test(brand) && isClerical) { drop = true; reasons.push('公司名含金融词+文职·疑似电销/增员'); }
  if (TRAP_BRAND.some(t => brand.includes(t))) { drop = true; reasons.push('保险/类保险主体·疑似增员'); }

  // 4) 销售/坑岗位名
  for (const re of TRAP_TITLE) if (re.test(name)) { drop = true; reasons.push('岗位名含销售/坑词'); break; }
  if (TRAP_WELFARE.test(welfare)) { demote = true; reasons.push('福利含提成(弱销售信号)'); }
  if (TRAP_SKILL.test(skills)) { drop = true; reasons.push('技能标签含销售'); }

  // 5) 薪资
  const [lo] = parseSalaryK(job.salaryDesc);
  if (lo === -1) { demote = true; reasons.push('计件/兼职薪资'); }
  if (opt.minK && lo > 0 && lo < opt.minK) { drop = true; reasons.push('低于目标薪资'); }

  return { drop, grade: drop ? 'x' : (demote ? 'B' : 'A'), reasons };
}

// —— JD 级坑标记：返回命中的坑标签数组（空 = 干净） ——
// ★ BOSS 正文常用 Unicode 部首兼容字(⽉⾏⼯⽂…)，必须先 NFKC 归一化，否则正则匹配不到。
function jdTrap(text) {
  const t = (text || '').normalize('NFKC');
  const noSales = /不销售|不电销|不打电话|无需销售|无销售性质|纯文职|非销售/.test(t);
  return JD_TRAPS.filter(x => {
    if (!x.re.test(t)) return false;
    if (x.tag === '伪装销售/电销' && noSales) {
      const stillRisky = /提成|业绩考核|开单|客户资源|了解客户资质|拓展客户/.test(t);
      return stillRisky;
    }
    return true;
  }).map(x => x.tag);
}

module.exports = { listFilter, jdTrap, parseSalaryK, ACTIVE_OK, ACTIVE_MEH };
