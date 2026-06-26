'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'approved.json'));
const errors = [];
const warnings = [];

function normalize(text) {
  return String(text || '').normalize('NFKC').replace(/\s+/g, '').trim();
}

if (!fs.existsSync(file)) {
  console.error(`FAIL ${file} not found`);
  process.exit(2);
}

let rows;
try {
  rows = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`FAIL invalid JSON: ${error.message}`);
  process.exit(2);
}

if (!Array.isArray(rows)) errors.push('approved file must be a JSON array');

const seenJobs = new Set();
const companyCounts = new Map();
const riskPattern = /销售|电销|邀约|客户资源|成交|转化率|提成|贷款|信贷|保险|培训费|押金|夜班|倒班|单休|大小周|形象气质|身高/;

for (const [index, job] of (Array.isArray(rows) ? rows : []).entries()) {
  const label = `#${index + 1} ${job.jobName || '(missing jobName)'}`;
  const id = job.encryptJobId || job.jobId || job.number || '';
  const jd = String(job.postDescription || job.jd || '').trim();
  const opening = String(job.opening || job.greeting || '').trim();
  const judge = job.judge || {};
  const evidence = String(judge.evidence || '').trim();
  const companyAssessment = String(judge.companyAssessment || '').trim();
  const baselineDecision = String(judge.baselineDecision || judge.floorDecision || '').trim();
  const riskDecision = String(judge.riskDecision || '').trim();

  for (const field of ['encryptBossId', 'securityId', 'encryptJobId', 'jobName', 'brandName']) {
    if (!job[field]) errors.push(`${label}: missing ${field}`);
  }

  if (id) {
    if (seenJobs.has(id)) errors.push(`${label}: duplicate job id ${id}`);
    seenJobs.add(id);
  }

  const company = normalize(job.brandName);
  if (company) companyCounts.set(company, (companyCounts.get(company) || 0) + 1);

  if (jd.length < 80) errors.push(`${label}: missing or too-short JD text`);
  if (opening.length < 35 || opening.length > 140) warnings.push(`${label}: opener length ${opening.length}`);
  if (!evidence || evidence.length < 6) errors.push(`${label}: missing judge.evidence`);
  else if (jd && !normalize(jd).includes(normalize(evidence))) errors.push(`${label}: evidence is not an exact JD excerpt`);
  if (companyAssessment.length < 8) errors.push(`${label}: missing judge.companyAssessment`);
  if (baselineDecision.length < 8) errors.push(`${label}: missing judge.baselineDecision`);
  if (riskPattern.test(`${job.jobName || ''} ${jd}`) && riskDecision.length < 8) {
    errors.push(`${label}: risk words found but judge.riskDecision is missing`);
  }
}

for (const [company, count] of companyCounts) {
  if (count > 2) errors.push(`same company appears more than twice: ${company}`);
}

console.log(`${errors.length ? 'FAIL' : 'PASS'} ${path.basename(file)} approved=${Array.isArray(rows) ? rows.length : 0} errors=${errors.length} warnings=${warnings.length}`);
for (const error of errors) console.log(`ERROR ${error}`);
for (const warning of warnings) console.log(`WARN ${warning}`);
process.exit(errors.length ? 2 : 0);

