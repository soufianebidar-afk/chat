const fs = require('fs');
const path = require('path');
function assert(cond,label){if(!cond)throw new Error(label);console.log('PASS | '+label)}
const editor = fs.readFileSync(path.join(__dirname,'..','editor.js'),'utf8');
const html = fs.readFileSync(path.join(__dirname,'..','editor.html'),'utf8');
const image = fs.readFileSync(path.join(__dirname,'..','image-editor.js'),'utf8');
const content = fs.readFileSync(path.join(__dirname,'..','content-script.js'),'utf8');
assert(editor.includes('target_attribute_type') && editor.includes('target_attribute_id') && editor.includes('source_dimension_label'), 'variant payload carries source and WooCommerce mapping metadata');
assert(editor.includes("'+ Créer un attribut global'") || editor.includes("+ Créer un attribut global"), 'variant UI offers global attribute creation');
assert(editor.includes('catalogAttributes()') && editor.includes('attribute_mappings'), 'variant UI consumes WooCommerce catalog and remembered mappings');
assert(html.includes('.variant-value-image{') && html.includes('width:64px;height:64px'), 'variant thumbnails are enlarged to 64px');
assert(image.includes('cdh:edit-external-image') && image.includes('cdh:external-image-updated'), 'Image Studio supports external variant image editing');
assert(editor.includes('image_media_id') && editor.includes('constello-variant-'), 'edited variant images are uploaded before import');
assert(content.includes("enabled( 'description'") && content.includes("enabled( 'variants'") && content.includes("enabled( 'characteristics'"), 'content extraction honors WordPress extraction profile');
assert(editor.includes('applyExtractionVisibility'), 'editor hides sections disabled by WordPress extraction profile');

assert(editor.includes('openVariantGroupKeys') && editor.includes('snapshotVariantAccordionState'), 'variant accordion open state is persisted across rerenders');
assert(editor.includes('captureVariantInteractionState') && editor.includes('restoreVariantInteractionState'), 'variant rerenders preserve scroll/focus context');
assert(editor.includes("details.dataset.groupKey = groupKey") && editor.includes("details.addEventListener( 'toggle'"), 'variant accordion state follows explicit user toggles');

assert(html.includes('category-search') && html.includes('category-options') && editor.includes('orderedCategories') && editor.includes('categoryPath'), 'category picker supports search and WooCommerce hierarchy');
assert(editor.includes('categoryRecentKey') && editor.includes('rememberCategory'), 'category picker remembers recent choices per shop');
assert(html.includes('include-video') && html.includes('video-add-description') && editor.includes('uploadVideoIfRequested'), 'video workspace can import supplier video into WordPress');
assert(editor.includes('variant-source-readonly') && html.includes('.variant-more-menu'), 'variant mapping UI keeps AliExpress source read-only and hides destructive actions in a menu');
assert(editor.includes("const mappingStatus = document.createElement( 'span' )") && editor.indexOf("const mappingStatus = document.createElement( 'span' )") < editor.indexOf('mappingStatus.textContent'), 'variant mapping status element is declared before syncTargetUi uses it');
assert(html.includes('check-stock') && html.includes('Stock fournisseur'), 'editor summary exposes supplier stock coverage');
assert(editor.includes('stock_qty') && editor.includes('stock_status') && editor.includes('supplier_sku_captured_at'), 'editor carries per-SKU stock monitoring fields');

assert(editor.includes('decodeHtmlEntities') && editor.includes("name: decodeHtmlEntities"), 'WooCommerce category names decode HTML entities before display');
assert(editor.includes('Non détecté · ${ stats.totalSkus } SKU à résoudre') && editor.includes('Payloads inventaire candidats'), 'stock UI distinguishes unknown stock and exposes inventory diagnostics');
assert(content.includes('resolveStock: true') && content.includes('stockResolveBudgetMs'), 'content extraction requests bounded active stock resolution');
assert(editor.includes('supplierStockSummary') && editor.includes('supplierStockLabel') && editor.includes('renderSupplierStockDetails'), 'pricing UI exposes exact stock quantities and per-SKU detail');
assert(editor.includes('Stock total observé') && editor.includes('Plage de stock') && html.includes('supplier-stock-table'), 'multi-SKU pricing shows total/min/max stock with a detail table');
assert(editor.includes('Indisponible fournisseur') && editor.includes('supplierOptionUsedByRealSku'), 'multi-dimensional source values without any real SKU are marked unavailable only after matrix completeness');
