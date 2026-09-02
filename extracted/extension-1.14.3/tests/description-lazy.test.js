const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(cond, label) {
  if (!cond) throw new Error(label);
  console.log('PASS | ' + label);
}
function makeRoot(map = {}, all = []) {
  return {
    querySelector(selector) { return map[selector] || null; },
    querySelectorAll(selector) { return selector === '*' ? all : []; },
  };
}

(async () => {
  let restoredY = null;
  const cleanClone = {
    innerHTML: '<p>Notes : produit réel</p><p>Paramètre : 220V</p><img src="https://ae-pic-a1.aliexpress-media.com/kf/a.jpg">',
    querySelectorAll() { return []; },
  };
  const rich = {
    innerHTML: cleanClone.innerHTML,
    cloneNode() { return cleanClone; },
    querySelector() { return null; },
  };
  const shadow = makeRoot({ '.detail-desc-decorate-richtext': rich });
  const host = {
    shadowRoot: null,
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const nav = {
    scrollIntoView() { host.shadowRoot = shadow; },
    querySelector(selector) {
      if (selector === '[data-pl="product-description"], #product-description') return host;
      return null;
    },
    querySelectorAll(selector) { return selector === '*' ? [host] : []; },
  };
  const document = makeRoot({ '#nav-description': nav }, [nav, host]);
  const ctx = {
    console, setTimeout, clearTimeout, Date, Math, Promise, URL, document,
    location: { href: 'https://de.aliexpress.com/item/1005009587413681.html', pathname: '/item/1005009587413681.html' },
    scrollY: 321,
    scrollTo(x, y) { restoredY = y; },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8'), ctx, { filename: 'content-script.js' });
  const result = await ctx.CDH.prepareDescriptionForEditor(250, 20);
  assert(result && result.status === 'extracted', 'lazy preparation extracts description after controlled scroll');
  assert(/Notes/.test(result.html), 'lazy preparation captures the real description HTML');
  assert(result.diagnostics && result.diagnostics.scrollAttempted === true, 'lazy preparation records the scroll attempt');
  assert(restoredY === 321, 'lazy preparation restores the original scroll position');
})();
