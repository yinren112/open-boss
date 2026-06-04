'use strict';

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const examplePath = path.join(__dirname, 'config.example.json');

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      '找不到 config.json。\n' +
      '请先在 open-boss 目录运行：npm run init\n' +
      '然后打开 config.json，改城市和岗位关键词。'
    );
  }
  return require(configPath);
}

function initConfig() {
  if (fs.existsSync(configPath)) {
    console.log('config.json 已存在，不覆盖。');
    return;
  }
  fs.copyFileSync(examplePath, configPath);
  console.log('已创建 config.json。请打开它，改城市和岗位关键词后再运行。');
}

module.exports = { loadConfig, initConfig };
