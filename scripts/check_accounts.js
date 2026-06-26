'use strict';

const { httpJson } = require('../cdp');
const cfg = require('../config').loadConfig();

async function main() {
  const accounts = cfg.accounts && cfg.accounts.length
    ? cfg.accounts
    : [{ name: 'default', port: cfg.cdpPort || 19222 }];

  let ok = true;
  for (const account of accounts) {
    try {
      const tabs = await httpJson(`http://127.0.0.1:${account.port}/json`);
      const bossTabs = tabs.filter(tab => /zhipin\.com/i.test(`${tab.url || ''} ${tab.title || ''}`));
      const loginTabs = bossTabs.filter(tab => /login|登录/i.test(`${tab.url || ''} ${tab.title || ''}`));
      const ready = bossTabs.length > 0 && loginTabs.length === 0;
      ok = ok && ready;
      console.log(`${ready ? 'OK' : 'FAIL'} ${account.name || 'account'} 127.0.0.1:${account.port} bossTabs=${bossTabs.length}`);
    } catch (error) {
      ok = false;
      console.log(`FAIL ${account.name || 'account'} 127.0.0.1:${account.port} ${error.message}`);
    }
  }
  process.exit(ok ? 0 : 2);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

