const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(cond, label) {
  if (!cond) throw new Error(label);
  console.log('PASS | ' + label);
}

function makeDocument(queryMap = {}, all = []) {
  return {
    querySelectorAll(selector) { return selector === '*' ? all : []; },
    querySelector(selector) { return queryMap[selector] || null; },
  };
}

const ctx = {
  console,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  Promise,
  URL,
  location: { href: 'https://www.aliexpress.com/item/1005000000000000.html', pathname: '/item/1005000000000000.html' },
  document: makeDocument(),
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
const code = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
vm.runInContext(code, ctx, { filename: 'content-script.js' });
const h = ctx.CDH.__test;
assert(h && typeof h.normalizeSupplierMediaUrl === 'function', 'content script exposes test hooks');
assert(h.normalizeSupplierMediaUrl('https://ae-pic-a1.aliexpress-media.com/kf/a.jpg').startsWith('https://'), 'HTTPS supplier media accepted');
assert(h.normalizeSupplierMediaUrl('//ae-pic-a1.aliexpress-media.com/kf/a.jpg').startsWith('https://'), 'protocol-relative supplier media normalized to HTTPS');
assert(h.normalizeSupplierMediaUrl('http://example.test/a.jpg') === '', 'HTTP supplier media rejected');
assert(h.normalizeSupplierMediaUrl('blob:https://example.test/id') === '', 'blob supplier media rejected');
assert(h.normalizeSupplierMediaUrl('file:///tmp/a.jpg') === '', 'file supplier media rejected');
assert(h.hasMeaningfulContent('<div><p>Hello</p></div>') === true, 'text description is meaningful');
assert(h.hasMeaningfulContent('<div><img src="x"></div>') === true, 'image-only description is meaningful');
assert(h.hasMeaningfulContent('<div></div>') === false, 'empty description container is rejected');

const domDescription = { innerHTML: '<div><p>DOM description</p></div>', querySelector() { return null; } };
ctx.document = makeDocument({ '#product-description': domDescription });
let read = h.tryReadDescriptionDetailed();
assert(read.html.includes('DOM description') && read.source === 'dom', 'DOM description is extracted');

const shadowDescription = { innerHTML: '<div><p>Shadow description</p></div>', querySelector() { return null; } };
const shadowRoot = makeDocument({ '.product-description': shadowDescription });
const host = { shadowRoot };
ctx.document = makeDocument({}, [host]);
read = h.tryReadDescriptionDetailed();
assert(read.html.includes('Shadow description') && read.source === 'shadow_dom', 'open Shadow DOM description is extracted');

const inaccessibleIframe = {};
Object.defineProperty(inaccessibleIframe, 'contentDocument', { get() { throw new Error('Blocked a frame'); } });
inaccessibleIframe.getAttribute = () => 'https://pdp.aliexpress-media.com/desc.htm';
inaccessibleIframe.src = 'https://pdp.aliexpress-media.com/desc.htm';
const iframeContainer = {
  innerHTML: '<iframe></iframe>',
  querySelector(selector) { return selector === 'iframe' ? inaccessibleIframe : null; },
};
ctx.document = makeDocument({ '#product-description': iframeContainer });
read = h.tryReadDescriptionDetailed();
assert(read.iframeFound === true && read.iframeAccessible === false, 'cross-origin iframe is diagnosed instead of crashing');

assert(h.descriptionRejectReason('<p>13 article(s) dans votre panier</p>') !== '', 'cart content is explicitly rejected as description');
assert(h.hasMeaningfulContent('<p>13 article(s) dans votre panier</p>') === false, 'cart false-positive is not meaningful product description');
const strongHtml = '<div class="detail-desc-decorate-richtext"><p><strong>Notes :</strong></p><p>Paramètre : Tension AC90-260V.</p><p>Caractéristiques : aluminium, garantie 3 ans.</p><img src="https://ae-pic-a1.aliexpress-media.com/kf/a.jpg"><img src="https://ae-pic-a1.aliexpress-media.com/kf/b.jpg"></div>';
assert(h.isTrustedDescriptionHtml(strongHtml, true) === true, 'rich AliExpress product description passes strict quality gate');

const cleanClone = {
  innerHTML: '<p>Notes : produit réel</p><p>Paramètre : 220V</p><img src="https://ae-pic-a1.aliexpress-media.com/kf/a.jpg">',
  querySelectorAll() { return []; },
};
const richDescriptionElement = {
  innerHTML: cleanClone.innerHTML,
  cloneNode() { return cleanClone; },
  querySelector() { return null; },
};
const richShadowRoot = makeDocument({ '.detail-desc-decorate-richtext': richDescriptionElement });
const innerShadowHost = { shadowRoot: richShadowRoot };
const productHost = {
  shadowRoot: null,
  querySelectorAll(selector) { return selector === '*' ? [innerShadowHost] : []; },
  querySelector() { return null; },
};
const navNode = {
  querySelector(selector) {
    if (selector === '[data-pl="product-description"], #product-description') return productHost;
    return null;
  },
  querySelectorAll() { return []; },
};
ctx.document = makeDocument({ '#nav-description': navNode });
const preferred = h.findPreferredDescriptionInNav();
assert(preferred && preferred.source === 'shadow_dom_exact', 'exact #nav-description Shadow DOM path is preferred');
assert(preferred && /Paramètre/.test(preferred.html), 'exact Shadow DOM extraction returns real product content');


// Regression terrain 1005009587413681 : le Shadow DOM peut être attaché directement
// au host sélectionné, pas seulement à un descendant.
const directRichElement = {
  innerHTML: cleanClone.innerHTML,
  cloneNode() { return cleanClone; },
  querySelector() { return null; },
};
const directShadowRoot = makeDocument({ '.detail-desc-decorate-richtext': directRichElement });
const directProductHost = {
  shadowRoot: directShadowRoot,
  querySelectorAll() { return []; },
  querySelector() { return null; },
};
const directNavNode = {
  querySelector(selector) {
    if (selector === '[data-pl="product-description"], #product-description') return directProductHost;
    return null;
  },
  querySelectorAll() { return []; },
};
ctx.document = makeDocument({ '#nav-description': directNavNode });
const directPreferred = h.findPreferredDescriptionInNav();
assert(directPreferred && /Paramètre/.test(directPreferred.html), 'direct host shadowRoot is traversed for exact description');

// Fallback declarative Shadow DOM : template[shadowrootmode=open].content reste
// interrogeable même si le navigateur n'a pas encore attaché shadowRoot au host.
const templateRichElement = {
  innerHTML: cleanClone.innerHTML,
  cloneNode() { return cleanClone; },
  querySelector() { return null; },
};
const templateContentRoot = makeDocument({ '.detail-desc-decorate-richtext': templateRichElement });
const templateNode = {
  tagName: 'TEMPLATE',
  shadowRoot: null,
  content: templateContentRoot,
  getAttribute(name) { return name === 'shadowrootmode' ? 'open' : null; },
  querySelectorAll() { return []; },
};
const templateChildHost = {
  shadowRoot: null,
  tagName: 'DIV',
  getAttribute() { return null; },
  querySelectorAll(selector) { return selector === '*' ? [templateNode] : []; },
};
const declarativeProductHost = {
  shadowRoot: null,
  querySelectorAll(selector) { return selector === '*' ? [templateChildHost, templateNode] : []; },
  querySelector() { return null; },
};
const declarativeNavNode = {
  querySelector(selector) {
    if (selector === '[data-pl="product-description"], #product-description') return declarativeProductHost;
    return null;
  },
  querySelectorAll() { return []; },
};
ctx.document = makeDocument({ '#nav-description': declarativeNavNode });
const declarativePreferred = h.findPreferredDescriptionInNav();
assert(declarativePreferred && /Paramètre/.test(declarativePreferred.html), 'declarative template shadowroot content is traversed for exact description');

const terrainFixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'description-1005009587413681.html'), 'utf8');
assert(h.descriptionQuality(terrainFixture).score >= 50, 'terrain fixture 1005009587413681 qualifies as product-description content');
assert(h.descriptionRejectReason(terrainFixture) === '', 'terrain fixture 1005009587413681 is not rejected as cart/navigation');

const shippingMoney = h.parseSupplierMoneyText('Livraison: CHF2.89', 'CHF');
assert(shippingMoney.known === true && shippingMoney.amount === 2.89 && shippingMoney.currency === 'CHF', 'current AliExpress shipping fee is parsed from DOM text');
const freeShipping = h.parseSupplierMoneyText('Livraison gratuite', 'CHF');
assert(freeShipping.known === true && freeShipping.amount === 0 && freeShipping.is_free === true, 'confirmed free shipping remains distinct from unknown shipping');
const unknownShipping = h.parseSupplierMoneyText('Livraison : sep. 10 - 18', 'CHF');
assert(unknownShipping.known === false && unknownShipping.amount === null, 'delivery dates are not mistaken for a zero shipping fee');
const deliveryWindow = h.parseDeliveryWindow('Livraison : sep. 10 - 18', new Date(2026, 8, 1, 12, 0, 0));
assert(deliveryWindow.delivery_date_start === '2026-09-10' && deliveryWindow.delivery_date_end === '2026-09-18', 'absolute supplier delivery window is retained as snapshot evidence');
assert(deliveryWindow.delivery_min_days === 9 && deliveryWindow.delivery_max_days === 17, 'delivery window is normalized to relative days for monitoring');

const sizeRange = h.parseSizeMeasurement('Hauteur:', '160-166cm');
assert(sizeRange && sizeRange.value_type === 'range' && sizeRange.min === 160 && sizeRange.max === 166 && sizeRange.unit === 'cm', 'size guide parses numeric measurement ranges');
const weightConflict = h.parseSizeMeasurement('Poids (kg):', '50-65cm');
assert(weightConflict && weightConflict.value_type === 'range' && weightConflict.min === 50 && weightConflict.max === 65 && weightConflict.unit === 'kg', 'size guide prefers explicit unit from measurement label');
assert(weightConflict.unit_conflict === true && weightConflict.raw_unit === 'cm' && weightConflict.raw_value === '50-65cm', 'size guide preserves and diagnoses supplier unit conflicts');
