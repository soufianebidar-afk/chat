const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log('PASS | ' + label);
}

async function runImportResponse(status, body) {
  let messageListener = null;
  const opened = [];
  const chrome = {
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => ({ cdh_site_url: 'https://shop.test', cdh_api_key: 'secret' }),
        set: async () => {},
      },
    },
    action: { onClicked: { addListener: () => {} } },
    runtime: {
      lastError: null,
      getURL: (file) => 'chrome-extension://test/' + file,
      onMessage: { addListener: (listener) => { messageListener = listener; } },
    },
    tabs: {
      create: async ({ url }) => { opened.push(url); return { id: opened.length }; },
      sendMessage: () => {},
    },
  };
  const context = {
    chrome,
    console,
    URL,
    URLSearchParams,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context, { filename: 'background.js' });
  assert(typeof messageListener === 'function', 'background registers its message listener');

  const result = await new Promise((resolve, reject) => {
    const asyncResponse = messageListener({ type: 'CDH_IMPORT', payload: { supplier_product_id: '100' } }, {}, resolve);
    if (asyncResponse !== true) reject(new Error('CDH_IMPORT did not keep the response channel open'));
  });
  return { result, opened };
}

(async () => {
  const replay = await runImportResponse(200, {
    product_id: 42,
    review_url: 'https://shop.test/wp-admin/post.php?post=42&action=edit',
    created: false,
    idempotent_replay: true,
    import_action: 'existing',
  });
  assert(replay.result.ok === true && replay.result.created === false, 'HTTP 200 replay is a successful import result');
  assert(replay.result.idempotent_replay === true && replay.result.product_id === 42, 'replay identity is preserved for the editor');
  assert(replay.opened.length === 1 && replay.opened[0].includes('post=42'), 'replay opens the existing WooCommerce product');

  const created = await runImportResponse(201, {
    product_id: 43,
    review_url: 'https://shop.test/wp-admin/post.php?post=43&action=edit',
    created: true,
    idempotent_replay: false,
    import_action: 'created',
  });
  assert(created.result.ok === true && created.result.created === true, 'HTTP 201 creation remains supported');
  assert(created.result.idempotent_replay === false && created.opened.length === 1, 'new-product behavior remains unchanged');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
