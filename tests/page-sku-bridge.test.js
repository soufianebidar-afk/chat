const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(cond, label) {
  if (!cond) throw new Error(label);
  console.log('PASS | ' + label);
}

const fixtureModule = {
  productSKUPropertyList: [
    {
      skuPropertyId: '14', skuPropertyName: 'Couleur',
      skuPropertyValues: [
        { propertyValueId: '193', propertyValueDisplayName: 'Black' },
        { propertyValueId: '175', propertyValueDisplayName: 'White' },
      ],
    },
    {
      skuPropertyId: '5', skuPropertyName: 'Prise',
      skuPropertyValues: [
        { propertyValueId: '100014064', propertyValueDisplayName: 'US' },
        { propertyValueId: '100014065', propertyValueDisplayName: 'EU' },
      ],
    },
  ],
  skuPriceList: [
    {
      skuId: 'sku-black-us',
      skuAttr: '14:193#Black;5:100014064#US',
      skuVal: {
        skuActivityAmount: { value: 12.25, currency: 'CHF' },
        skuAmount: { value: 14.50, currency: 'CHF' },
        availQuantity: 7,
      },
    },
    {
      skuId: 'sku-white-eu',
      skuPropIds: '175,100014065',
      skuVal: {
        skuAmount: { value: 18.75, currency: 'CHF' },
        availQuantity: 0,
      },
    },
  ],
};

const document = {
  scripts: [],
  querySelectorAll() { return []; },
};
const windowObj = {
  __CDH_TEST_MODE__: true,
  runParams: { data: { skuModule: fixtureModule, descriptionModule: { descriptionHtml: '<div><p>Runtime description fixture</p><img src="https://example.test/a.jpg"></div>' } } },
  addEventListener() {},
  postMessage() {},
};
windowObj.window = windowObj;
windowObj.document = document;
const context = {
  window: windowObj,
  document,
  console,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  Promise,
  WeakSet,
  Map,
  URL,
};
context.globalThis = windowObj;
vm.createContext(context);
const code = fs.readFileSync(path.join(__dirname, '..', 'page-sku-bridge.js'), 'utf8');
vm.runInContext(code, context, { filename: 'page-sku-bridge.js' });
const h = windowObj.__CDH_PAGE_BRIDGE_TEST__;
assert(h && typeof h.normalizeSkuData === 'function', 'bridge exposes test hooks');

const normalized = h.normalizeSkuData(fixtureModule, 'fixture', {});
assert(normalized.dimensions.length === 2, 'two SKU dimensions normalized');
assert(normalized.combinations.length === 2, 'two real SKU combinations normalized');
assert(normalized.combinations[0].supplier_price.amount === 12.25, 'activity price preferred for first SKU');
assert(normalized.combinations[1].supplier_price.amount === 18.75, 'regular price preserved for second SKU');
assert(normalized.combinations[0].supplier_price.amount !== normalized.combinations[1].supplier_price.amount, 'distinct SKU costs stay distinct');
assert(normalized.combinations[0].attributes.length === 2, 'skuAttr maps to both dimensions');
assert(normalized.combinations[1].attributes.length === 2, 'comma-only skuPropIds maps via property value ids');
assert(normalized.combinations[1].available === false, 'zero stock becomes unavailable');
assert(normalized.combinations[0].stock_qty === 7 && normalized.combinations[0].stock_status === 'in_stock', 'positive per-SKU quantity is preserved with in_stock status');
assert(normalized.combinations[1].stock_qty === 0 && normalized.combinations[1].stock_status === 'out_of_stock', 'real zero stock is preserved separately from unknown stock');
assert(normalized.diagnostics.stock_qty_rows === 2 && normalized.diagnostics.stock_status_rows === 2, 'stock coverage diagnostics count SKU quantities and statuses');

const oneDimPartial = {
  source: 'partial-one-dim',
  dimensions: [{ property_id: '14', name: 'Couleur', values: [
    { value_id:'1', label:'black yellow 1.5m' }, { value_id:'2', label:'black white 1.5m' },
    { value_id:'3', label:'black white 1m' }, { value_id:'4', label:'brown 1m' },
    { value_id:'5', label:'brown 1.5m' }, { value_id:'6', label:'yellow 1m' },
    { value_id:'7', label:'yellow 1.5m' }, { value_id:'8', label:'white 1m' },
  ] }],
  combinations: [1,2,3,4].map((n) => ({ supplier_sku_id:`sku-${n}`, attributes:[{property_id:'14',value_id:String(n),name:'Couleur',value:['black yellow 1.5m','black white 1.5m','black white 1m','brown 1m'][n-1]}], supplier_price:{amount:6+n/10,currency:'CHF'} })),
  diagnostics:{},
};
const partialCoverage = h.matrixCoverage(oneDimPartial);
assert(partialCoverage.complete === false && partialCoverage.expected_skus === 8 && partialCoverage.verified_skus === 4, 'one-dimension matrix detects 4 verified SKU out of 8 expected options');
assert(partialCoverage.missing.length === 4 && partialCoverage.missing.some((x) => x.label === 'brown 1.5m'), 'matrix diagnostics list visible supplier values that still need a real SKU');
const completeOneDim = JSON.parse(JSON.stringify(oneDimPartial));
completeOneDim.combinations = completeOneDim.dimensions[0].values.map((v, i) => ({supplier_sku_id:`sku-${i+1}`,attributes:[{property_id:'14',value_id:v.value_id,name:'Couleur',value:v.label}],supplier_price:{amount:7+i/10,currency:'CHF'}}));
assert(h.matrixCoverage(completeOneDim).complete === true, 'one-dimension matrix becomes complete only when every option has a verified real SKU');

const objectMapModule = {
  productSKUPropertyList: fixtureModule.productSKUPropertyList,
  skuMap: {
    a: fixtureModule.skuPriceList[0],
    b: fixtureModule.skuPriceList[1],
  },
};
const objectMapped = h.normalizeSkuData(objectMapModule, 'object-map', {});
assert(objectMapped.combinations.length === 2, 'object skuMap is accepted');

const missingPrice = JSON.parse(JSON.stringify(fixtureModule));
delete missingPrice.skuPriceList[0].skuVal.skuActivityAmount;
delete missingPrice.skuPriceList[0].skuVal.skuAmount;
const missingNormalized = h.normalizeSkuData(missingPrice, 'missing-price', {});
assert(missingNormalized.combinations[0].supplier_price === null, 'missing SKU price remains null and is never invented');

const desc = h.findDescriptionInObject({ x: { descriptionHtml: '<section><p>Long enough description HTML fixture</p></section>' } }, 5, 'root');
assert(desc && /Long enough/.test(desc.html), 'runtime description HTML is detected');
const descUrl = h.findDescriptionInObject({ descriptionModule: { descriptionUrl: 'https://pdp.aliexpress-media.com/product/description/test.htm' } }, 5, 'root');
assert(descUrl && descUrl.url && /^https:/.test(descUrl.url.url), 'runtime description URL is diagnosed without fetching it');

const modernNetworkFixture = {
  data: {
    description: {
      descriptionHtml: '<section><p>Network description fixture</p><img src="https://example.test/net.jpg"></section>',
    },
    sku: {
      skuProperties: [
        {
          skuPropertyId: '14', skuPropertyName: 'Couleur',
          skuPropertyValues: [
            { propertyValueIdLong: '193', propertyValueDisplayName: 'Black' },
            { propertyValueIdLong: '175', propertyValueDisplayName: 'White' },
          ],
        },
        {
          skuPropertyId: '5', skuPropertyName: 'Prise',
          skuPropertyValues: [
            { propertyValueIdLong: '100014064', propertyValueDisplayName: 'US' },
            { propertyValueIdLong: '100014065', propertyValueDisplayName: 'EU' },
          ],
        },
      ],
    },
    skuIdPrices: {
      '120000000000001': { salePriceString: 'CHF 12.25', originalPrice: { value: 14.50, currency: 'CHF' } },
      '120000000000002': { salePriceString: 'CHF 18.75', originalPrice: { value: 20.00, currency: 'CHF' } },
    },
    skuPathMap: {
      '14:193#Black;5:100014064#US': { skuId: '120000000000001' },
      '14:175#White;5:100014065#EU': { skuId: '120000000000002' },
    },
    quantity: {
      allSkuQuantity: {
        '120000000000001': { stock: 9 },
        '120000000000002': { stock: 2 },
      },
    },
  },
};
const modern = h.normalizeModernSkuPayload(modernNetworkFixture, 'network-fixture', {});
assert(modern && modern.dimensions.length === 2, 'modern network payload exposes SKU dimensions');
assert(modern.combinations.length === 2, 'modern network payload maps only real SKU combinations');
assert(modern.combinations[0].supplier_price.amount === 12.25, 'modern network current SKU price parsed from salePriceString');
assert(modern.combinations[1].supplier_price.amount === 18.75, 'modern network keeps distinct per-SKU prices');
assert(modern.combinations.every((row) => row.attributes.length === 2), 'modern network SKU ids map back to all option dimensions');
assert(modern.combinations[0].stock === 9, 'modern network stock map is joined by SKU id');
assert(modern.combinations[0].stock_qty === 9 && modern.combinations[1].stock_qty === 2, 'modern network quantity is preserved per supplier SKU');
assert(modern.combinations.every((row) => row.stock_status === 'in_stock'), 'modern network quantities derive explicit stock status');
assert(modern.diagnostics.modern_quantity_path && /allSkuQuantity/.test(modern.diagnostics.modern_quantity_path), 'stock source path is recorded for diagnostics');

const availabilityOnly = h.stockInfo({ isAvailable: true });
assert(availabilityOnly.qty === null && availabilityOnly.available === true && availabilityOnly.status === 'in_stock', 'availability without quantity remains in_stock with unknown quantity');
const unknownStock = h.stockInfo({ foo: 'bar' });
assert(unknownStock.qty === null && unknownStock.available === null && unknownStock.status === 'unknown', 'missing stock data stays unknown and is never converted to zero');
const alternativeStock = h.stockInfo({ inventoryQuantity: 13 });
assert(alternativeStock.qty === 13 && alternativeStock.status === 'in_stock', 'alternative AliExpress inventoryQuantity field is normalized');

const priceOnlyPayload = { source:'price', dimensions:modern.dimensions, combinations:modern.combinations.map((row) => ({...row, stock:null, stock_qty:null, stock_status:'unknown', available:null})), diagnostics:{}, captured_at:'2026-09-01T18:00:00Z' };
const stockOnlyPayload = { source:'stock', dimensions:modern.dimensions, combinations:modern.combinations.map((row) => ({supplier_sku_id:row.supplier_sku_id, stock:row.stock_qty, stock_qty:row.stock_qty, stock_status:row.stock_status, available:row.available})), diagnostics:{}, captured_at:'2026-09-01T18:00:01Z' };
const mergedStockPayload = h.mergeSkuPayload(priceOnlyPayload, stockOnlyPayload);
assert(mergedStockPayload.combinations[0].supplier_price.amount === 12.25, 'late stock enrichment does not lose verified supplier price');
assert(mergedStockPayload.combinations[0].stock_qty === 9, 'late stock payload enriches cached SKU by supplier SKU id');


const stockOnlyNetworkFixture = {
  data: {
    inventory: {
      skuInventoryMap: {
        '120000000000001': { availableQuantity: 6, sellable: true },
        '120000000000002': { availableQuantity: 0, sellable: false },
      },
    },
  },
};
const stockOnlyNormalized = h.normalizeStockOnlyPayload(
  stockOnlyNetworkFixture,
  'network-stock-only',
  {},
  new Set(['120000000000001', '120000000000002'])
);
assert(stockOnlyNormalized && stockOnlyNormalized.combinations.length === 2, 'stock-only network payload is recognized without a price map');
assert(stockOnlyNormalized.combinations[0].stock_qty === 6, 'stock-only payload preserves positive SKU quantity');
assert(stockOnlyNormalized.combinations[1].stock_qty === 0 && stockOnlyNormalized.combinations[1].stock_status === 'out_of_stock', 'stock-only payload preserves real zero separately from unknown');
assert(Array.isArray(stockOnlyNormalized.diagnostics.stock_source_paths) && stockOnlyNormalized.diagnostics.stock_source_paths.length > 0, 'stock-only source paths are exposed for diagnostics');

const noMappingFixture = JSON.parse(JSON.stringify(modernNetworkFixture));
delete noMappingFixture.data.skuPathMap;
const noMapping = h.normalizeModernSkuPayload(noMappingFixture, 'network-no-mapping', {});
assert(noMapping && noMapping.dimensions.length === 2, 'modern network dimensions survive without a SKU mapping');
assert(noMapping.combinations.length === 0, 'price ids without option mapping remain fail-closed');

const parsedJsonp = h.parseNetworkJson('mtopjsonp1({"data":{"ok":true}});');
assert(parsedJsonp && parsedJsonp.data.ok === true, 'MTOP JSONP response is parsed passively');
assert(h.parseLocalizedAmount('CHF 22,75') === 22.75, 'localized comma amount is parsed correctly');

const inspected = h.inspectStructuredNetworkPayload(modernNetworkFixture, { kind: 'test', url: 'https://acs.aliexpress.com/h5/mtop.aliexpress.pdp.pc.query/1.0/' });
assert(inspected && inspected.combinations.length === 2, 'passive network inspector recognizes modern SKU response');


const genericDesc = h.findDescriptionInObject(
  { data: '&lt;div class="detail-desc-decorate-richtext"&gt;&lt;p&gt;Generic network description&lt;/p&gt;&lt;img src="https://example.test/d.jpg"&gt;&lt;/div&gt;' },
  5,
  'network.data',
  { urlHint: 'https://example.test/product/description/data.json' }
);
assert(genericDesc && /Generic network description/.test(genericDesc.html), 'description endpoint generic data field is recognized and HTML entities decoded');
assert(h.descriptionCandidateScore('root.review.html', '<div><p>review text long enough</p></div>', '') < h.descriptionCandidateScore('root.description.html', '<div><p>description text long enough</p></div>', ''), 'description scoring prefers description paths over unrelated review HTML');

const cartFalsePositive = h.findDescriptionInObject(
  { data: '<div><p>13 article(s) dans votre panier</p></div>' },
  5,
  'network.data',
  { urlHint: 'https://example.test/product/description/data.json' }
);
assert(!cartFalsePositive || !cartFalsePositive.html, 'generic network cart HTML is rejected even on a description-like endpoint');
assert(h.descriptionRejectReason('<div>13 article(s) dans votre panier</div>') !== '', 'bridge exposes explicit cart false-positive rejection');
const realFixtureDescription = '<div class="detail-desc-decorate-richtext"><p><strong>Notes :</strong></p><p>Paramètre : AC90-260V 50/60Hz</p><p>Caractéristiques : aluminium et garantie 3 ans.</p><p>Conseils utiles : contacter le service client si nécessaire.</p><img src="https://ae-pic-a1.aliexpress-media.com/kf/a.jpg"><img src="https://ae-pic-a1.aliexpress-media.com/kf/b.jpg"></div>';
const strictGenericDescription = h.findDescriptionInObject(
  { data: realFixtureDescription },
  5,
  'network.data',
  { urlHint: 'https://example.test/product/description/data.json' }
);
assert(strictGenericDescription && /Paramètre/.test(strictGenericDescription.html), 'strong generic description payload remains accepted as last-resort fallback');


const adjustContext = {
  missing: { property_id: '14', dimension: 'Couleur', value_id: '5', label: 'brown 1.5m' },
  dimensions: oneDimPartial.dimensions,
  knownBefore: ['12000056095611520','12000056095611524','12000056095611522','12000056095611526'],
  allowSelectedInference: true,
};
const pdpAdjustFixture = {
  data: { result: { SKU: {
    selectedSkuId: '12000056095611530',
    skuPaths: {
      '4': { skuId: '12000056095611520', skuAttr: '14:1#black yellow 1.5m' },
      '5': { skuId: '12000056095611524', skuAttr: '14:2#black white 1.5m' },
      '6': { skuId: '12000056095611522', skuAttr: '14:3#black white 1m' },
      '7': { skuId: '12000056095611530' },
    },
    skuPrices: {
      '4': { salePriceString: 'CHF 7.29', currency: 'CHF' },
      '5': { salePriceString: 'CHF 6.92', currency: 'CHF' },
      '6': { salePriceString: 'CHF 6.93', currency: 'CHF' },
      '7': { salePriceString: 'CHF 6.83', currency: 'CHF' },
    },
    skuInventory: {
      '4': { availableQuantity: 100 },
      '5': { availableQuantity: 0 },
      '6': { availableQuantity: 98 },
      '7': { availableQuantity: 98 },
    },
  } } },
};
const adjustRows = h.collectPdpAdjustSkuCandidates(pdpAdjustFixture, adjustContext);
assert(adjustRows.rows.some((row) => row.supplier_sku_id === '12000056095611530' && row.supplier_price && row.supplier_price.amount === 6.83 && row.stock_qty === 98), 'pdp.pc.adjust sibling skuPaths/price/inventory maps are joined by path index');
const normalizedAdjust = h.normalizePdpAdjustPayload(pdpAdjustFixture, 'network:xhr:mtop.aliexpress.pdp.pc.adjust', {}, adjustContext);
const brown15 = normalizedAdjust && normalizedAdjust.combinations.find((row) => row.supplier_sku_id === '12000056095611530');
assert(brown15 && brown15.attributes.length === 1 && brown15.attributes[0].value === 'brown 1.5m', 'selected pdp.pc.adjust SKU is context-bound to the explicitly clicked one-dimensional option');
assert(brown15.supplier_price.amount === 6.83 && brown15.stock_qty === 98, 'contextual adjust row preserves real supplier price and stock quantity');

// Multi-dimensional completeness is based on real SKU paths, not a theoretical cartesian grid.
const multiPathPayload = {
  source:'multi-path',
  dimensions:[
    {property_id:'14',name:'Couleur',values:[{value_id:'1',label:'Black'},{value_id:'2',label:'Brown'}]},
    {property_id:'200',name:'Hauteur',values:[{value_id:'10',label:'100cm'},{value_id:'20',label:'200cm'},{value_id:'30',label:'300cm'}]},
  ],
  combinations:[
    {supplier_sku_id:'m1',sku_attr:'14:1#Black;200:10#100cm',attributes:[{property_id:'14',value_id:'1',name:'Couleur',value:'Black'},{property_id:'200',value_id:'10',name:'Hauteur',value:'100cm'}],supplier_price:{amount:8,currency:'CHF'}},
    {supplier_sku_id:'m2',sku_attr:'14:2#Brown;200:10#100cm',attributes:[{property_id:'14',value_id:'2',name:'Couleur',value:'Brown'},{property_id:'200',value_id:'10',name:'Hauteur',value:'100cm'}],supplier_price:{amount:9,currency:'CHF'}},
    {supplier_sku_id:'m3',sku_attr:'14:1#Black;200:20#200cm',attributes:[{property_id:'14',value_id:'1',name:'Couleur',value:'Black'},{property_id:'200',value_id:'20',name:'Hauteur',value:'200cm'}],supplier_price:{amount:10,currency:'CHF'}},
  ], diagnostics:{}
};
const multiCoverage = h.matrixCoverage(multiPathPayload);
assert(multiCoverage.complete === true && multiCoverage.exact === false, 'multi-dimensional matrix is complete when every real priced SKU has one full unique property path');
assert(multiCoverage.unused_values.some((x) => x.label === '300cm'), 'multi-dimensional display value without a real SKU is informational as potentially unavailable');
const multiBroken = JSON.parse(JSON.stringify(multiPathPayload));
multiBroken.combinations.push({supplier_sku_id:'m4',attributes:[{property_id:'14',value_id:'2',name:'Couleur',value:'Brown'}],supplier_price:{amount:11,currency:'CHF'}});
const multiBrokenCoverage = h.matrixCoverage(multiBroken);
assert(multiBrokenCoverage.complete === false && multiBrokenCoverage.unmapped_skus.includes('m4'), 'real priced multi-dimensional SKU without a full path keeps the matrix fail-closed');

const multiAdjustContext = {
  missing:{property_id:'200',dimension:'Hauteur',value_id:'30',label:'300cm'},
  dimensions:multiPathPayload.dimensions,
  knownBefore:[], allowSelectedInference:false,
};
const multiAdjustFixture = {data:{result:{SKU:{
  skuPaths:{
    '0':{skuId:'9001'},
    '1':{skuId:'9002'},
  },
  skuPrices:{
    '0':{salePriceString:'CHF 8.20',currency:'CHF'},
    '1':{salePriceString:'CHF 9.30',currency:'CHF'},
  },
  skuInventory:{
    '0':{availableQuantity:12},
    '1':{availableQuantity:0},
  },
  skuPathMap:{
    '14:1#Black;200:10#100cm':{skuId:'9001'},
    '14:2#Brown;200:20#200cm':{skuId:'9002'},
  },
}}}};
const multiAdjustRows = h.collectPdpAdjustSkuCandidates(multiAdjustFixture, multiAdjustContext);
const row9001 = multiAdjustRows.rows.find((row) => row.supplier_sku_id === '9001');
const row9002 = multiAdjustRows.rows.find((row) => row.supplier_sku_id === '9002');
assert(row9001 && row9001.attributes.length === 2 && row9001.stock_qty === 12, 'pdp.adjust reconciles a multi-dimensional SKU path stored in a separate mapping subtree');
assert(row9002 && row9002.attributes.length === 2 && row9002.stock_qty === 0, 'multi-dimensional path reconciliation preserves a real zero stock');
const normalizedMultiAdjust = h.normalizePdpAdjustPayload(multiAdjustFixture, 'network:xhr:mtop.aliexpress.pdp.pc.adjust', {}, multiAdjustContext);
assert(normalizedMultiAdjust && normalizedMultiAdjust.combinations.length === 2 && h.matrixCoverage(normalizedMultiAdjust).complete === true, 'contextual pdp.adjust promotes only real SKUs with complete multi-dimensional paths');
