'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skipDirs = new Set(['.git', 'node_modules']);
const patterns = [
  ['windows-user-path', /C:\\Users\\/i],
  ['known-private-name', /卡迪热娅|小卡|澳鹏|Appen|西南大学|wapadil/i],
  ['phone-like-number', /(?:\+?86[-\s]?)?1[3-9]\d{9}/],
  ['id-card-like-number', /\b\d{17}[\dXx]\b/],
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
];
const hits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    const file = path.join(dir, entry.name);
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (rel === 'scripts/privacy_scan.js') continue;
    if (!/\.(js|json|md|txt|yml|yaml)$/i.test(entry.name)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const [name, pattern] of patterns) {
      const match = text.match(pattern);
      if (match) hits.push(`${rel}: ${name}: ${match[0].slice(0, 80)}`);
    }
  }
}

walk(root);

if (hits.length) {
  console.log(`FAIL privacy scan hits=${hits.length}`);
  for (const hit of hits) console.log(`HIT ${hit}`);
  process.exit(2);
}
console.log('PASS privacy scan');
