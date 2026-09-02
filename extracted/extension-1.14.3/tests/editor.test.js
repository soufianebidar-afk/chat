const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(cond, label) {
  if (!cond) throw new Error(label);
  console.log('PASS | ' + label);
}

const ctx = { console, URL, Map, Set };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'editor.js'), 'utf8'), ctx, { filename: 'editor.js' });
const e = ctx.CDHEditor;
assert(e.normalizeEditorMediaUrl('https://example.test/a.jpg').startsWith('https://'), 'editor accepts HTTPS media');
assert(e.normalizeEditorMediaUrl('http://example.test/a.jpg') === '', 'editor rejects HTTP media consistently');
assert(e.normalizeEditorMediaUrl('data:image/webp;base64,AAAA').startsWith('data:image/'), 'editor keeps local edited data image');
assert(e.normalizeSupplierOptionValue("L'", 'Taille') === 'L', 'stray supplier apostrophe is normalized for a clothing size');
assert(e.normalizeSupplierOptionValue("L'", 'Modèle') === "L'", 'supplier apostrophe is preserved outside a size dimension');
const normalizedSizeGroups = e.groupVariants([{supplier_variation_key:"size:l'",source_property_id:'5',dimension_label:'Taille',label_raw:"L'",source_value_id:'361385'}]);
assert(normalizedSizeGroups[0].options[0].value === "L'" && normalizedSizeGroups[0].options[0].wooValue === 'L', 'variant grouping preserves raw supplier size and proposes normalized WooCommerce value');

const base = {
  supplier_key: 'aliexpress',
  supplier_product_id: 'base-product',
  title: 'Produit',
  base_price: { amount: 12, currency: 'CHF' },
  images: ['https://example.test/a.jpg'],
  variants: [],
  supplier_variations: [],
};
assert(e.validatePayload(base, 'CHF').ok === true, 'simple product validates without SKU matrix');
assert(e.validatePayload({ ...base, supplier_product_id: null }, 'CHF').errors.some(x => /Identité produit fournisseur/i.test(x)), 'supplier product identity is required before import');

const badName = { ...base, variants: [{ supplier_variation_key: 'x:white', label_raw: 'White' }] };
assert(e.validatePayload(badName, 'CHF').errors.some(x => /nom d.attribut/i.test(x)), 'empty variant attribute is rejected');

const variableMissingSku = { ...base, variants: [{ supplier_variation_key: 'color:white', label_raw: 'White' }] };
assert(e.validatePayload(variableMissingSku, 'CHF').errors.some(x => /SKU\/prix/i.test(x)), 'variable product without real SKU matrix is fail-closed');

const variableValid = {
  ...variableMissingSku,
  supplier_variations: [{ supplier_sku_id: 'sku-1', supplier_price: { amount: 13.5, currency: 'CHF' }, attributes: [{ name: 'Color', value: 'White' }] }],
};
assert(e.validatePayload(variableValid, 'CHF').ok === true, 'variable product with verified SKU price validates');

const partialMatrixPayload = {
  ...base,
  variants: ['A','B','C','D','E','F','G','H'].map((value) => ({supplier_variation_key:`color:${value.toLowerCase()}`,dimension_label:'Color',label_raw:value,source_label_raw:value})),
  supplier_variations: ['A','B','C','D'].map((value, i) => ({supplier_sku_id:`sku-${i+1}`,supplier_price:{amount:10+i,currency:'CHF'},attributes:[{name:'Color',value}]})),
};
const partialMatrixValidation = e.validatePayload(partialMatrixPayload, 'CHF');
assert(partialMatrixValidation.ok === false && partialMatrixValidation.errors.some((x) => /Matrice SKU AliExpress incomplète/i.test(x)), 'editor blocks import when 8 source values are visible but only 4 real SKU are verified');
const partialStats = e.supplierMatrixCoverage(partialMatrixPayload);
assert(partialStats.exact === true && partialStats.expectedSkus === 8 && partialStats.verifiedSkus === 4 && partialStats.missing.length === 4, 'editor reports exact 4/8 SKU coverage for a one-dimension product');
const intentionalSubset = {...partialMatrixPayload, variants: partialMatrixPayload.variants.slice(0,4)};
assert(e.validatePayload(intentionalSubset, 'CHF').ok === true, 'user can intentionally keep only the subset whose real supplier SKU are verified');

const stockMappedPayload = e.buildPayload({
  supplier_key:'aliexpress', supplier_product_id:'2', supplier_url:'https://de.aliexpress.com/item/2.html',
  title:'Stocked', priceAmount:12, priceCurrency:'CHF', images:['https://example.test/a.jpg'], imageMediaIds:[null],
  brand:'', availability:'', rating:{value:null,count:null}, characteristics:[], supplier:{}, category_id:null,
  supplierSkuSource:'network:test', supplierSkuCapturedAt:'2026-09-01T18:00:00.000Z', supplierSkuDiagnostics:{stock_qty_rows:1},
  variantGroups:[{sourceAttribute:'Color',attribute:'Color',sourcePropertyId:'14',wooTargetType:'product',wooAttributeName:'Color',options:[{value:'White',wooValue:'White',sourceValueId:'29'}]}],
  supplierVariations:[{supplier_sku_id:'sku-stock-1',sku_attr:'14:29#White',attributes:[{property_id:'14',value_id:'29',name:'Color',value:'White'}],supplier_price:{amount:13.5,currency:'CHF'},supplier_regular_price:{amount:14,currency:'CHF'},stock_qty:4,stock_status:'in_stock',available:true}],
});
assert(stockMappedPayload.supplier_variations[0].stock_qty === 4 && stockMappedPayload.supplier_variations[0].stock === 4, 'editor payload preserves supplier stock quantity per SKU');
assert(stockMappedPayload.supplier_variations[0].stock_status === 'in_stock' && stockMappedPayload.supplier_variations[0].available === true, 'editor payload preserves supplier stock status per SKU');
assert(stockMappedPayload.supplier_variations[0].observed_at === '2026-09-01T18:00:00.000Z', 'editor payload timestamps the SKU stock observation');
assert(stockMappedPayload.supplier_sku_source === 'network:test' && stockMappedPayload.supplier_sku_captured_at, 'editor payload carries SKU snapshot source and capture time');

const simpleSkuPayload = e.buildPayload({
  supplier_key:'aliexpress', supplier_product_id:'3', supplier_url:'https://de.aliexpress.com/item/3.html',
  title:'Simple stocked', priceAmount:9, priceCurrency:'CHF', images:['https://example.test/a.jpg'], imageMediaIds:[null],
  brand:'', availability:'', rating:{value:null,count:null}, characteristics:[], supplier:{}, category_id:null,
  supplierSkuCapturedAt:'2026-09-01T18:05:00.000Z', supplierVariantDimensions:[], variantGroups:[],
  supplierVariations:[{supplier_sku_id:'simple-sku',attributes:[],supplier_price:{amount:9,currency:'CHF'},stock_qty:11,stock_status:'in_stock',available:true}],
});
assert(simpleSkuPayload.supplier_variations.length === 1 && simpleSkuPayload.supplier_variations[0].stock_qty === 11, 'genuinely simple product keeps its supplier SKU stock for monitoring');
assert(e.validatePayload(variableValid, 'EUR').errors.some(x => /Devise AliExpress/i.test(x)), 'currency mismatch is rejected');

const mappedPayload = e.buildPayload({
  supplier_key:'aliexpress', supplier_product_id:'1', supplier_url:'https://de.aliexpress.com/item/1.html',
  title:'Mapped', priceAmount:12, priceCurrency:'CHF', images:['https://example.test/a.jpg'], imageMediaIds:[null],
  brand:'', availability:'', rating:{value:null,count:null}, characteristics:[], supplier:{}, supplierVariations:[], category_id:null,
  variantGroups:[{sourceAttribute:'Color',attribute:'Color',sourcePropertyId:'14',wooTargetType:'global',wooAttributeId:7,wooTaxonomy:'pa_color',wooAttributeName:'Couleur',options:[{value:'White',wooValue:'Blanc',imageUrl:'data:image/webp;base64,AAAA',imageMediaId:null,sourceValueId:'29'}]}]
});
assert(mappedPayload.variants[0].source_dimension_label === 'Color', 'variant payload preserves AliExpress source attribute');
assert(mappedPayload.variants[0].dimension_label === 'pa_color', 'global WooCommerce taxonomy is used as pricing dimension');
assert(mappedPayload.variants[0].target_attribute_id === 7 && mappedPayload.variants[0].target_attribute_name === 'Couleur', 'variant payload carries WooCommerce attribute mapping');
assert(mappedPayload.variants[0].source_label_raw === 'White' && mappedPayload.variants[0].label_raw === 'Blanc', 'variant value mapping preserves source and target values');
assert(mappedPayload.variants[0].image_url.startsWith('data:image/'), 'edited variant image stays in payload until media upload');
assert(e.validatePayload({...base, images:[]}, 'CHF', {images:false}).ok === true, 'image extraction can be disabled by WordPress profile');

const backgroundSrc = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
assert(backgroundSrc.includes('CDH_IMPORT_VIDEO') && backgroundSrc.includes('/wp-json/cdh/v1/import-video'), 'background relays video import to WordPress');
assert(backgroundSrc.includes('response.ok && body && body.review_url') && backgroundSrc.includes('idempotent_replay: body.idempotent_replay === true'), 'background accepts HTTP 200 idempotent replay and preserves its outcome');
const editorSrc = fs.readFileSync(path.join(__dirname, '..', 'editor.js'), 'utf8');
assert(editorSrc.includes('aucun doublon créé') && editorSrc.includes('response.idempotent_replay'), 'editor reports an idempotent replay distinctly from a new product');

const oneStock = e.supplierStockSummary([{supplier_sku_id:'one',stock_qty:143,stock_status:'in_stock',available:true}]);
assert(oneStock.totalSkus === 1 && oneStock.qtyCount === 1 && oneStock.totalQty === 143 && oneStock.minQty === 143 && oneStock.maxQty === 143, 'stock summary exposes exact single-SKU quantity');
assert(e.supplierStockLabel([{supplier_sku_id:'one',stock_qty:143,stock_status:'in_stock',available:true}]) === '143 unités', 'single-SKU stock label shows real quantity instead of coverage count');
const multiStock = e.supplierStockSummary([
  {supplier_sku_id:'a',stock_qty:42,stock_status:'in_stock',available:true},
  {supplier_sku_id:'b',stock_qty:18,stock_status:'in_stock',available:true},
  {supplier_sku_id:'c',stock_qty:0,stock_status:'out_of_stock',available:false},
  {supplier_sku_id:'d',stock_qty:31,stock_status:'in_stock',available:true},
]);
assert(multiStock.totalQty === 91 && multiStock.minQty === 0 && multiStock.maxQty === 42 && multiStock.outOfStockCount === 1, 'multi-SKU stock summary exposes total range and ruptures');
assert(e.supplierStockLabel([{supplier_sku_id:'x',stock_qty:null,stock_status:'unknown',available:null}]).includes('Non détecté'), 'unknown stock remains distinct from zero stock in UI helper');
assert(e.supplierStockLabel([{supplier_sku_id:'x',stock_qty:0,stock_status:'out_of_stock',available:false}]).includes('Rupture'), 'real zero stock is rendered as rupture');
const supplierCosts = [
  {supplier_sku_id:'c1',supplier_price:{amount:27,currency:'CHF'}},
  {supplier_sku_id:'c2',supplier_price:{amount:31.79,currency:'CHF'}},
];
const supplierCostLabel = e.supplierCostLabel(supplierCosts);
const supplierCostSummary = e.supplierCostSummary(supplierCosts);
assert(supplierCostSummary.min === 27 && supplierCostSummary.max === 31.79 && supplierCostLabel.includes('CHF') && supplierCostLabel.includes('→') && supplierCostLabel.includes('2 SKU'), 'supplier cost summary exposes real min/max range and SKU count');
assert(e.supplierCostSummary([...supplierCosts,{supplier_sku_id:'c3',supplier_price:{amount:29,currency:'EUR'}}]).mixedCurrencies === true, 'supplier cost summary flags mixed currencies instead of presenting a misleading common currency');
const sharedObservation = '2026-09-02T07:10:00.000Z';
assert(e.commonSupplierObservation([{observed_at:sharedObservation},{observed_at:sharedObservation}]) === sharedObservation, 'common SKU observation is detected for compact stock header');
assert(e.commonSupplierObservation([{observed_at:sharedObservation},{observed_at:'2026-09-02T07:11:00.000Z'}]) === '', 'per-SKU observation remains visible when timestamps differ');
assert(e.supplierVerificationLabel('2000-01-02T07:10:00.000Z').startsWith('Vérifié le'), 'supplier delivery freshness exposes an explicit verification date');

const multiDimEditorPayload = {
  ...base,
  variants:[
    {supplier_variation_key:'color:black',dimension_label:'Color',label_raw:'Black'},
    {supplier_variation_key:'color:brown',dimension_label:'Color',label_raw:'Brown'},
    {supplier_variation_key:'height:100',dimension_label:'Height',label_raw:'100cm'},
    {supplier_variation_key:'height:200',dimension_label:'Height',label_raw:'200cm'},
    {supplier_variation_key:'height:300',dimension_label:'Height',label_raw:'300cm'},
  ],
  supplier_variations:[
    {supplier_sku_id:'mx1',supplier_price:{amount:8,currency:'CHF'},attributes:[{name:'Color',value:'Black'},{name:'Height',value:'100cm'}]},
    {supplier_sku_id:'mx2',supplier_price:{amount:9,currency:'CHF'},attributes:[{name:'Color',value:'Brown'},{name:'Height',value:'200cm'}]},
  ],
  supplier_sku_diagnostics:{matrix_verified_skus:2,matrix_mapped_skus:2,matrix_unmapped_sku_count:0},
};
const multiDimEditorCoverage = e.supplierMatrixCoverage(multiDimEditorPayload);
assert(multiDimEditorCoverage.complete === true && multiDimEditorCoverage.unused.some((x) => x.value === '300cm'), 'editor does not require every multi-dimensional display value to appear in a real SKU');
assert(e.validatePayload(multiDimEditorPayload, 'CHF').ok === true, 'editor allows a complete real multi-dimensional SKU matrix with an unavailable display value');
const multiDimDropped = {...multiDimEditorPayload,supplier_variations:multiDimEditorPayload.supplier_variations.slice(0,1),supplier_sku_diagnostics:{matrix_verified_skus:2,matrix_mapped_skus:1,matrix_unmapped_sku_count:1}};
const multiDimDroppedCoverage = e.supplierMatrixCoverage(multiDimDropped);
assert(multiDimDroppedCoverage.complete === false && multiDimDroppedCoverage.unresolvedSkus === 1, 'editor blocks when one real multi-dimensional supplier SKU is lost during attribute mapping');

const shippingSummary = e.supplierShippingSummary({fee:2.89,fee_known:true,currency:'CHF',delivery_min_days:9,delivery_max_days:17,reference_supplier_price:15.79,supplier_sku_id:'ship-sku'}, 12, []);
assert(shippingSummary.feeKnown === true && Math.abs(shippingSummary.landedCost - 18.68) < 0.001, 'editor calculates reference landed cost without changing supplier price');
assert(e.shippingUiLabel({fee:2.89,fee_known:true,currency:'CHF',delivery_min_days:9,delivery_max_days:17,reference_supplier_price:15.79}, 12, []).includes('9–17 j'), 'shipping UI shows relative delivery delay rather than dynamic calendar dates');
const shippingUnknown = e.supplierShippingSummary({fee:null,fee_known:false,currency:'CHF'}, 15.79, []);
assert(shippingUnknown.feeKnown === false && shippingUnknown.landedCost === null, 'unknown shipping fee is never treated as free shipping');
const shippingPayload = e.buildPayload({
  supplier_key:'aliexpress',supplier_product_id:'shipping-1',supplier_url:'https://www.aliexpress.com/item/shipping-1.html',title:'Shipping',priceAmount:15.79,priceCurrency:'CHF',images:['https://example.test/a.jpg'],imageMediaIds:[null],brand:'',availability:'',rating:{value:null,count:null},characteristics:[],supplier:{},supplierVariations:[],variantGroups:[],category_id:null,
  shippingCurrent:{fee:2.89,fee_known:true,currency:'CHF',delivery_date_start:'2026-09-10',delivery_date_end:'2026-09-18',delivery_min_days:9,delivery_max_days:17,quantity:1,source:'aliexpress_dom'}
});
assert(shippingPayload.shipping_current && shippingPayload.shipping_current.fee === 2.89 && shippingPayload.shipping_current.delivery_min_days === 9, 'shipping observation is carried separately in the import payload');

const guideState = {
  sizeGuideInclude:true,
  sizeGuide:{source_attribute:"XSSML'XL",source_property_id:'5',unit:'cm',sizes:[{source_value:"L'",source_value_id:'361385',measurements:[{name:'Buste',value:74,unit:'cm',source:'manual',supplier_value:null}]}]},
  variantGroups:[{sourceAttribute:'Taille',attribute:'Taille',sourcePropertyId:'5',wooTargetType:'product',wooAttributeName:'Taille',options:[{value:"L'",wooValue:'L',sourceValueId:'361385'}]}]
};
const guidePayload = e.sizeGuidePayload(guideState);
assert(guidePayload.target_attribute === 'Taille' && guidePayload.sizes[0].target_value === 'L', 'size guide uses WooCommerce display label while preserving supplier size identity');
assert(guidePayload.sizes[0].source_value === "L'" && guidePayload.sizes[0].measurements[0].source === 'manual', 'manual size measurement provenance is preserved in payload');
const incompleteGuide = e.sizeGuidePayload({
  sizeGuideInclude:true,
  sizeGuide:{source_attribute:'Taille',source_property_id:'5',sizes:[{source_value:'M',source_value_id:'1',measurements:[{name:'Buste',value:70,unit:'cm'}]},{source_value:"L'",source_value_id:'2',measurements:[]}]},
  variantGroups:[{sourceAttribute:'Taille',sourcePropertyId:'5',wooAttributeName:'Taille',options:[{value:'M',wooValue:'M',sourceValueId:'1'},{value:"L'",wooValue:'L',sourceValueId:'2'}]}],
});
assert(incompleteGuide.sizes.length === 2 && incompleteGuide.sizes[1].target_value === 'L' && incompleteGuide.sizes[1].measurements.length === 0, 'incomplete size guide remains importable without inventing measurements');
