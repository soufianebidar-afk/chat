/**
 * Constello Dropship Hub — AliExpress SKU bridge (MAIN world)
 *
 * Reads SKU/price data already present in the AliExpress runtime/network.
 * Stock resolution is passive first. If stock is still unknown, a bounded resolver may select
 * only already-verified SKU options so AliExpress can expose its own availability response.
 * Constello never adds to cart and never invents a SKU/stock value.
 */
(function () {
  'use strict';
  if (window.__CDH_SKU_BRIDGE__) return;
  window.__CDH_SKU_BRIDGE__ = true;

  // Capture warm cache: AliExpress can expose runParams/data only during hydration and later
  // replace/remove parts of that runtime state. Start observing from document_start and keep the
  // first complete SKU matrix found, instead of waiting until the user opens the editor.
  let warmSkuPayload = null;
  let warmSkuPromise = null;
  let warmDescription = null;
  let networkPartialPayload = null;
  let matrixResolverContext = null;
  let matrixResolverSequence = 0;

  // Passive network observation. AliExpress PDP pages are increasingly client-rendered shells:
  // the page itself obtains product/SKU data from MTOP after document_start. We observe only
  // responses that AliExpress already requested; Constello never issues an AliExpress request here.
  const networkDiagnostics = {
    network_observer_installed: false,
    network_requests_observed: 0,
    network_fetch_responses: 0,
    network_xhr_responses: 0,
    network_jsonp_scripts: 0,
    network_jsonp_payloads: 0,
    network_json_inspected: 0,
    network_text_inspected: 0,
    network_sku_candidates: 0,
    network_description_candidates: 0,
    network_modern_price_rows: 0,
    network_mapping_rows: 0,
    network_inventory_candidates: 0,
    network_stock_only_rows: 0,
    stock_resolver_runs: 0,
    stock_resolver_attempted_skus: 0,
    stock_resolver_resolved_skus: 0,
    stock_resolver_clicks: 0,
    stock_resolver_timeouts: 0,
    stock_resolver_last_error: '',
    matrix_resolver_runs: 0,
    matrix_resolver_attempted_values: 0,
    matrix_resolver_resolved_values: 0,
    matrix_resolver_timeouts: 0,
    matrix_resolver_clicks: 0,
    matrix_resolver_last_error: '',
    matrix_adjust_responses: 0,
    matrix_adjust_candidate_rows: 0,
    matrix_adjust_context_matches: 0,
    matrix_adjust_inferred_rows: 0,
    matrix_adjust_last_url: '',
    matrix_adjust_sku_path_rows: 0,
    matrix_adjust_full_path_rows: 0,
    matrix_adjust_unmapped_rows: 0,
    matrix_selected_inferred_rows: 0,
    network_candidate_urls: [],
  };

  function asArray(value) { return Array.isArray(value) ? value : []; }
  function asRecords(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      try { return Object.values(value).filter((item) => item && typeof item === 'object'); } catch (e) {}
    }
    return [];
  }
  function text(value) { return value == null ? '' : String(value).trim(); }
  function number(value) { const n = parseFloat(value); return Number.isFinite(n) ? n : null; }

  function bool(value) {
    if (value === true || value === false) return value;
    if (value == null || value === '') return null;
    if (typeof value === 'number') return value !== 0;
    const normalized = text(value).toLowerCase();
    if (['true', '1', 'yes', 'y', 'available', 'instock', 'in_stock', 'sellable'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'soldout', 'outofstock', 'out_of_stock', 'unavailable'].includes(normalized)) return false;
    return null;
  }

  function stockInfo() {
    const sources = Array.from(arguments).filter((item) => item && typeof item === 'object');
    const quantityKeys = [
      'availQuantity', 'availableQuantity', 'inventory', 'stock', 'currentCount', 'quantity',
      'stockQuantity', 'inventoryQuantity', 'sellableQuantity', 'availableStock', 'leftQuantity',
      'skuStock', 'skuInventory', 'remainingQuantity', 'availableCount', 'stockCount', 'totalStock'
    ];
    let qty = null;
    for (const source of sources) {
      for (const key of quantityKeys) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        const candidate = number(source[key]);
        if (candidate != null && candidate >= 0) { qty = candidate; break; }
      }
      if (qty != null) break;
    }

    let available = null;
    const positiveKeys = ['available', 'isAvailable', 'sellable', 'isSellable', 'canBuy', 'purchasable', 'isPurchasable', 'enabled'];
    const negativeKeys = ['soldOut', 'isSoldOut', 'outOfStock', 'isOutOfStock', 'disabled'];
    for (const source of sources) {
      if (available == null) {
        for (const key of positiveKeys) {
          if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
          const candidate = bool(source[key]);
          if (candidate != null) { available = candidate; break; }
        }
      }
      if (available == null) {
        for (const key of negativeKeys) {
          if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
          const candidate = bool(source[key]);
          if (candidate != null) { available = !candidate; break; }
        }
      }
      if (available != null) break;
    }
    if (qty != null) available = qty > 0;
    const status = qty != null ? (qty > 0 ? 'in_stock' : 'out_of_stock') : (available === true ? 'in_stock' : available === false ? 'out_of_stock' : 'unknown');
    return { qty, available, status };
  }

  function addStockDiagnostics(diagnostics, combinations) {
    const rows = Array.isArray(combinations) ? combinations : [];
    const qtyKnown = rows.filter((row) => row && row.stock_qty != null).length;
    const statusKnown = rows.filter((row) => row && row.stock_status && row.stock_status !== 'unknown').length;
    diagnostics.stock_rows = Math.max(Number(diagnostics.stock_rows || 0), rows.length);
    diagnostics.stock_qty_rows = Math.max(Number(diagnostics.stock_qty_rows || 0), qtyKnown);
    diagnostics.stock_status_rows = Math.max(Number(diagnostics.stock_status_rows || 0), statusKnown);
    diagnostics.stock_in_stock_rows = Math.max(Number(diagnostics.stock_in_stock_rows || 0), rows.filter((row) => row && row.stock_status === 'in_stock').length);
    diagnostics.stock_out_of_stock_rows = Math.max(Number(diagnostics.stock_out_of_stock_rows || 0), rows.filter((row) => row && row.stock_status === 'out_of_stock').length);
    diagnostics.stock_unknown_rows = Math.max(Number(diagnostics.stock_unknown_rows || 0), rows.filter((row) => !row || !row.stock_status || row.stock_status === 'unknown').length);
    return diagnostics;
  }

  function stockCoverage(payload) {
    const rows = payload && Array.isArray(payload.combinations) ? payload.combinations : [];
    if (!rows.length) return { rows: 0, qty: 0, status: 0 };
    return {
      rows: rows.length,
      qty: rows.filter((row) => row && row.stock_qty != null).length,
      status: rows.filter((row) => row && row.stock_status && row.stock_status !== 'unknown').length,
    };
  }


  function knownSkuIdSet() {
    const ids = new Set();
    const sources = [warmSkuPayload, networkPartialPayload];
    for (const payload of sources) {
      for (const row of payload && Array.isArray(payload.combinations) ? payload.combinations : []) {
        const id = text(row && row.supplier_sku_id);
        if (id) ids.add(id);
      }
    }
    return ids;
  }

  function stockMetaFromValue(value) {
    if (value == null) return { qty: null, available: null, status: 'unknown' };
    if (typeof value === 'number' || typeof value === 'string') {
      const qty = number(value);
      if (qty == null || qty < 0) return { qty: null, available: null, status: 'unknown' };
      return { qty, available: qty > 0, status: qty > 0 ? 'in_stock' : 'out_of_stock' };
    }
    return stockInfo(value);
  }

  function collectStockOnlyRows(root, knownIds) {
    const ids = knownIds && typeof knownIds.has === 'function' ? knownIds : new Set();
    const rows = new Map();
    const paths = new Map();
    if (!root || typeof root !== 'object' || !ids.size) return { rows: [], paths: [] };

    const remember = (skuId, sourceValue, path) => {
      const id = text(skuId);
      if (!id || !ids.has(id)) return;
      const meta = stockMetaFromValue(sourceValue);
      if (meta.qty == null && meta.status === 'unknown' && meta.available == null) return;
      const previous = rows.get(id);
      const next = {
        supplier_sku_id: id,
        stock: meta.qty,
        stock_qty: meta.qty,
        stock_status: meta.status,
        available: meta.available,
      };
      if (!previous || previous.stock_qty == null || next.stock_qty != null || previous.stock_status === 'unknown') rows.set(id, Object.assign({}, previous || {}, next));
      if (path) paths.set(id, path);
    };

    const queue = [{ value: root, depth: 0, path: 'network' }];
    const seen = new WeakSet();
    let visited = 0;
    while (queue.length && visited < 16000) {
      const item = queue.shift();
      const value = item.value;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value); visited++;

      const directId = text(value.skuId ?? value.sku_id ?? value.skuIdStr ?? value.skuCode ?? value.offerId ?? value.id);
      if (directId && ids.has(directId)) remember(directId, value, item.path);

      let entries = [];
      try { entries = Object.entries(value); } catch (e) { continue; }
      for (const [key, child] of entries) {
        const path = item.path + '.' + key;
        if (ids.has(String(key))) remember(String(key), child, path);

        const stockLikeKey = /(?:stock|inventory|quantity|available|sellable|soldout|outofstock)/i.test(key);
        if (stockLikeKey && child && typeof child === 'object') {
          let nestedEntries = [];
          try { nestedEntries = Object.entries(child); } catch (e) {}
          for (const [nestedKey, nestedValue] of nestedEntries) {
            if (ids.has(String(nestedKey))) remember(String(nestedKey), nestedValue, path + '.' + nestedKey);
            else if (nestedValue && typeof nestedValue === 'object') {
              const nestedId = text(nestedValue.skuId ?? nestedValue.sku_id ?? nestedValue.skuIdStr ?? nestedValue.id);
              if (nestedId && ids.has(nestedId)) remember(nestedId, nestedValue, path + '.' + nestedKey);
            }
          }
        }

        if (child && typeof child === 'object' && item.depth < 11) {
          if (typeof Node !== 'undefined' && child instanceof Node) continue;
          queue.push({ value: child, depth: item.depth + 1, path });
        }
      }
    }
    return { rows: Array.from(rows.values()), paths: Array.from(new Set(paths.values())) };
  }

  function normalizeStockOnlyPayload(root, source, diagnostics, knownIds) {
    const ids = knownIds && typeof knownIds.has === 'function' ? knownIds : knownSkuIdSet();
    if (!ids.size) return null;
    const found = collectStockOnlyRows(root, ids);
    if (!found.rows.length) return null;
    networkDiagnostics.network_inventory_candidates++;
    networkDiagnostics.network_stock_only_rows = Math.max(networkDiagnostics.network_stock_only_rows, found.rows.length);
    diagnostics = diagnostics || {};
    diagnostics.network_inventory_candidates = Math.max(Number(diagnostics.network_inventory_candidates || 0), networkDiagnostics.network_inventory_candidates);
    diagnostics.network_stock_only_rows = Math.max(Number(diagnostics.network_stock_only_rows || 0), found.rows.length);
    diagnostics.stock_source_paths = found.paths.slice(0, 12);
    addStockDiagnostics(diagnostics, found.rows);
    return {
      source: source + ':stock-only',
      dimensions: [],
      combinations: found.rows,
      diagnostics,
      captured_at: new Date().toISOString(),
    };
  }

  function rowHasKnownStock(row) {
    return !!row && (row.stock_qty != null || (row.stock_status && row.stock_status !== 'unknown') || row.available != null);
  }

  function findWarmSkuRow(skuId) {
    const id = text(skuId);
    for (const payload of [warmSkuPayload, networkPartialPayload]) {
      const row = payload && Array.isArray(payload.combinations) ? payload.combinations.find((item) => text(item && item.supplier_sku_id) === id) : null;
      if (row) return row;
    }
    return null;
  }

  function visibleDimensionValues(dimension, dimensionsCount) {
    if (typeof document === 'undefined' || !document.querySelectorAll) return [];
    const propertyId = text(dimension && dimension.property_id);
    const nodes = Array.from(document.querySelectorAll('[data-sku-col]'));
    const relevant = nodes.filter((node) => {
      const raw = text(node.getAttribute && node.getAttribute('data-sku-col'));
      if (!raw) return false;
      if (propertyId && (raw === propertyId || raw.startsWith(propertyId + '-') || raw.startsWith(propertyId + ':'))) return true;
      return Number(dimensionsCount || 0) === 1;
    });
    const out = [];
    for (const node of relevant) {
      const raw = text(node.getAttribute && node.getAttribute('data-sku-col'));
      const parts = raw.split(/[-:]/).filter(Boolean);
      const img = node.querySelector && node.querySelector('img');
      const label = text((img && img.getAttribute('alt')) || (node.getAttribute && (node.getAttribute('title') || node.getAttribute('aria-label'))) || node.textContent);
      const valueId = parts.length > 1 ? parts[parts.length - 1] : '';
      if (!label && !valueId) continue;
      if (!out.some((item) => (valueId && item.value_id === valueId) || (label && item.label.toLowerCase() === label.toLowerCase()))) out.push({ value_id: valueId, label });
    }
    return out;
  }

  function rowAttributeForDimension(row, dimension) {
    const attrs = Array.isArray(row && row.attributes) ? row.attributes : [];
    const propertyId = text(dimension && dimension.property_id);
    const dimensionName = text(dimension && dimension.name).toLowerCase();
    return attrs.find((attr) => {
      const attrPropertyId = text(attr && attr.property_id);
      const attrName = text(attr && attr.name).toLowerCase();
      if (propertyId && attrPropertyId) return propertyId === attrPropertyId;
      return !!dimensionName && !!attrName && dimensionName === attrName;
    }) || null;
  }

  function rowHasFullDimensionPath(row, dimensions) {
    if (!row || !Array.isArray(dimensions) || !dimensions.length) return true;
    return dimensions.every((dimension) => {
      const attr = rowAttributeForDimension(row, dimension);
      return !!(attr && (text(attr.value_id) || text(attr.value)));
    });
  }

  function rowDimensionPathKey(row, dimensions) {
    if (!rowHasFullDimensionPath(row, dimensions)) return '';
    return dimensions.map((dimension) => {
      const attr = rowAttributeForDimension(row, dimension) || {};
      return `${text(dimension && dimension.property_id) || text(dimension && dimension.name).toLowerCase()}:${text(attr.value_id) || text(attr.value).toLowerCase()}`;
    }).join('|');
  }

  function matrixCoverage(payload) {
    const dimensions = payload && Array.isArray(payload.dimensions) ? payload.dimensions : [];
    const rows = payload && Array.isArray(payload.combinations) ? payload.combinations : [];
    const verifiedRows = rows.filter(rowHasVerifiedSkuPrice);
    if (!dimensions.length) return { complete: true, exact: true, expected_skus: rows.length ? 1 : 0, verified_skus: verifiedRows.length, mapped_skus: verifiedRows.length, total_values: 0, missing: [], unused_values: [], unmapped_skus: [], duplicate_paths: [], visible_values: 0 };

    const unusedValues = [];
    let totalValues = 0;
    let visibleValues = 0;
    for (const dimension of dimensions) {
      const defined = Array.isArray(dimension && dimension.values) ? dimension.values : [];
      const visible = visibleDimensionValues(dimension, dimensions.length);
      visibleValues += visible.length;
      const values = defined.slice();
      for (const item of visible) {
        if (!values.some((value) => (item.value_id && text(value && value.value_id) === item.value_id) || (item.label && text(value && value.label).toLowerCase() === item.label.toLowerCase()))) values.push(item);
      }
      totalValues += values.length;
      for (const value of values) {
        const propertyId = text(dimension && dimension.property_id);
        const valueId = text(value && value.value_id);
        const label = text(value && value.label).toLowerCase();
        const observed = verifiedRows.some((row) => {
          const attr = rowAttributeForDimension(row, dimension);
          if (!attr) return false;
          if (valueId && text(attr.value_id) === valueId) return true;
          return !!label && text(attr.value).toLowerCase() === label;
        });
        if (!observed) unusedValues.push({ property_id: propertyId, dimension: text(dimension && dimension.name), value_id: valueId, label: text(value && value.label) });
      }
    }

    const mappedRows = verifiedRows.filter((row) => rowHasFullDimensionPath(row, dimensions));
    const unmappedRows = verifiedRows.filter((row) => !rowHasFullDimensionPath(row, dimensions));
    const pathCounts = new Map();
    for (const row of mappedRows) {
      const key = rowDimensionPathKey(row, dimensions);
      if (!key) continue;
      pathCounts.set(key, (pathCounts.get(key) || 0) + 1);
    }
    const duplicatePaths = Array.from(pathCounts.entries()).filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
    const exact = dimensions.length === 1;
    const expected = exact ? totalValues : null;
    // Single dimension: every visible/defined option must have one real priced SKU.
    // Multi dimension: visible values are not a cartesian promise. A value may legitimately be
    // unavailable. Completeness is therefore based on every real priced SKU having one unique,
    // full AliExpress property path; unused display values are informational only.
    const complete = exact
      ? unusedValues.length === 0 && mappedRows.length >= expected && unmappedRows.length === 0 && duplicatePaths.length === 0
      : verifiedRows.length > 0 && mappedRows.length === verifiedRows.length && duplicatePaths.length === 0;
    const missing = exact ? unusedValues.slice() : unusedValues.slice();
    return {
      complete, exact, expected_skus: expected, verified_skus: verifiedRows.length, mapped_skus: mappedRows.length,
      total_values: totalValues, missing, unused_values: unusedValues,
      unmapped_skus: unmappedRows.map((row) => text(row && row.supplier_sku_id)).filter(Boolean),
      duplicate_paths: duplicatePaths, visible_values: visibleValues,
    };
  }

  function rowHasVerifiedSkuPrice(row) {
    return !!(row && text(row.supplier_sku_id) && row.supplier_price && number(row.supplier_price.amount) > 0);
  }

  function addMatrixDiagnostics(diagnostics, payload) {
    const out = diagnostics || {};
    const coverage = matrixCoverage(payload || {});
    out.matrix_complete = coverage.complete;
    out.matrix_exact = coverage.exact;
    out.matrix_expected_skus = coverage.expected_skus;
    out.matrix_verified_skus = coverage.verified_skus;
    out.matrix_mapped_skus = coverage.mapped_skus;
    out.matrix_dimension_values = coverage.total_values;
    out.matrix_visible_values = coverage.visible_values || 0;
    out.matrix_missing_value_count = coverage.exact ? coverage.missing.length : 0;
    out.matrix_missing_values = coverage.exact ? coverage.missing.map((item) => `${item.dimension || item.property_id || 'Attribut'}: ${item.label || item.value_id || '?'}`) : [];
    out.matrix_unused_value_count = coverage.unused_values.length;
    out.matrix_unused_values = coverage.unused_values.map((item) => `${item.dimension || item.property_id || 'Attribut'}: ${item.label || item.value_id || '?'}`);
    out.matrix_unmapped_sku_count = coverage.unmapped_skus.length;
    out.matrix_unmapped_sku_ids = coverage.unmapped_skus.slice(0, 16);
    out.matrix_duplicate_path_count = coverage.duplicate_paths.length;
    return out;
  }

  function rowMatchesMatrixValue(row, missing) {
    return !!(row && Array.isArray(row.attributes) && row.attributes.some((attr) => {
      if (missing.property_id && text(attr && attr.property_id) && text(attr.property_id) !== text(missing.property_id)) return false;
      if (missing.value_id && text(attr && attr.value_id) === text(missing.value_id)) return true;
      return !!missing.label && text(attr && attr.value).toLowerCase() === text(missing.label).toLowerCase();
    }));
  }

  function mergedWarmPayload(base) {
    return mergeSkuPayload(mergeSkuPayload(base, networkPartialPayload), warmSkuPayload);
  }

  function refreshWarmSkuFromRuntime(base) {
    const diagnostics = mergeNetworkDiagnostics({ matrix_runtime_refresh: true });
    try {
      const found = locateSkuModuleInRuntime(diagnostics) || findSkuContainerInScripts(diagnostics);
      if (found) {
        const fresh = normalizeSkuData(found.module, found.source, diagnostics);
        warmSkuPayload = mergeSkuPayload(warmSkuPayload, fresh);
        return mergedWarmPayload(base);
      }
    } catch (e) {}
    return mergedWarmPayload(base);
  }

  async function waitForMatrixValue(base, missing, timeoutMs, allowSelectedInference, knownBefore) {
    const deadline = Date.now() + Math.max(120, Number(timeoutMs || 600));
    const priorIds = knownBefore instanceof Set ? knownBefore : new Set();
    const resolveRow = (merged) => {
      const rows = merged && Array.isArray(merged.combinations) ? merged.combinations : [];
      const direct = rows.find((item) => rowMatchesMatrixValue(item, missing) && rowHasVerifiedSkuPrice(item));
      if (direct) return direct;
      if (!allowSelectedInference) return null;
      const fresh = rows.filter((item) => rowHasVerifiedSkuPrice(item) && !priorIds.has(text(item.supplier_sku_id)));
      if (fresh.length !== 1) return null;
      const inferred = fresh[0];
      inferred.attributes = [{ property_id: text(missing.property_id), value_id: text(missing.value_id), name: text(missing.dimension), value: text(missing.label) }];
      if (!inferred.sku_attr) inferred.sku_attr = `${text(missing.property_id)}:${text(missing.value_id)}#${text(missing.label)}`;
      networkDiagnostics.matrix_selected_inferred_rows++;
      warmSkuPayload = mergeSkuPayload(warmSkuPayload, { source: 'selected-option-inference', dimensions: base && base.dimensions || [], combinations: [inferred], diagnostics: {}, captured_at: new Date().toISOString() });
      return inferred;
    };
    do {
      let merged = mergedWarmPayload(base);
      let row = resolveRow(merged);
      if (row) return { payload: mergedWarmPayload(merged), row };
      merged = refreshWarmSkuFromRuntime(base);
      row = resolveRow(merged);
      if (row) return { payload: mergedWarmPayload(merged), row };
      await new Promise((resolve) => setTimeout(resolve, 80));
    } while (Date.now() < deadline);
    const merged = refreshWarmSkuFromRuntime(base);
    const row = resolveRow(merged);
    return { payload: mergedWarmPayload(merged), row };
  }

  async function resolveIncompleteSkuMatrix(payload, options) {
    const initial = matrixCoverage(payload);
    if (!payload || initial.complete || !initial.missing.length) {
      if (payload) payload.diagnostics = addMatrixDiagnostics(mergeNetworkDiagnostics(payload.diagnostics || {}), payload);
      return payload;
    }
    const opts = options || {};
    networkDiagnostics.matrix_resolver_runs++;
    const maxAttempts = Math.max(1, Math.min(40, Number(opts.maxMatrixResolveValues || 24)));
    const totalBudget = Math.max(900, Math.min(8500, Number(opts.matrixResolveBudgetMs || 6500)));
    const perValueWait = Math.max(180, Math.min(1200, Number(opts.matrixResolvePerValueMs || 700)));
    const deadline = Date.now() + totalBudget;
    const selectedBefore = Array.from(document.querySelectorAll('[data-sku-col]')).filter(isLikelySelectedVariantNode);
    let current = payload;
    let attempted = 0;
    let resolved = 0;

    for (const missing of initial.missing.slice(0, maxAttempts)) {
      if (Date.now() >= deadline) { networkDiagnostics.matrix_resolver_timeouts++; break; }
      attempted++; networkDiagnostics.matrix_resolver_attempted_values++;
      const node = optionNodeForAttribute({ value_id: missing.value_id, value: missing.label });
      if (!node) continue;
      const knownBefore = new Set((current && Array.isArray(current.combinations) ? current.combinations : []).map((item) => text(item && item.supplier_sku_id)).filter(Boolean));
      matrixResolverContext = {
        id: ++matrixResolverSequence,
        missing: Object.assign({}, missing),
        dimensions: current && Array.isArray(current.dimensions) ? current.dimensions : (payload && Array.isArray(payload.dimensions) ? payload.dimensions : []),
        knownBefore: Array.from(knownBefore),
        allowSelectedInference: !! initial.exact,
        startedAt: Date.now(),
      };
      if (!isLikelySelectedVariantNode(node)) {
        clickVariantNode(node, 'matrix');
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      const remaining = Math.max(120, Math.min(perValueWait, deadline - Date.now()));
      const found = await waitForMatrixValue(current, missing, remaining, initial.exact, knownBefore);
      current = found.payload || current;
      if (found.row) { resolved++; networkDiagnostics.matrix_resolver_resolved_values++; }
      if (matrixResolverContext && matrixResolverContext.id === matrixResolverSequence) matrixResolverContext = null;
    }

    matrixResolverContext = null;
    for (const node of selectedBefore) {
      if (Date.now() >= deadline + 700) break;
      if (!isLikelySelectedVariantNode(node)) { clickVariantNode(node, 'matrix'); await new Promise((resolve) => setTimeout(resolve, 35)); }
    }
    current = refreshWarmSkuFromRuntime(current);
    current.diagnostics = addMatrixDiagnostics(mergeNetworkDiagnostics(Object.assign({}, current.diagnostics || {}, {
      matrix_resolver_attempted_this_run: attempted,
      matrix_resolver_resolved_this_run: resolved,
      matrix_resolver_budget_ms: totalBudget,
    })), current);
    return current;
  }

  function optionNodeForAttribute(attr) {
    const valueId = text(attr && attr.value_id);
    const label = text(attr && attr.value).toLowerCase();
    const nodes = Array.from(document.querySelectorAll('[data-sku-col]'));
    if (valueId) {
      const exact = nodes.find((node) => {
        const raw = text(node.getAttribute && node.getAttribute('data-sku-col'));
        const parts = raw.split('-');
        return raw === valueId || parts[parts.length - 1] === valueId || raw.endsWith('-' + valueId);
      });
      if (exact) return exact;
    }
    if (label) {
      return nodes.find((node) => {
        const img = node.querySelector && node.querySelector('img');
        const candidate = text((img && img.getAttribute('alt')) || (node.getAttribute && (node.getAttribute('title') || node.getAttribute('aria-label'))) || node.textContent).toLowerCase();
        return candidate === label;
      }) || null;
    }
    return null;
  }

  function isLikelySelectedVariantNode(node) {
    if (!node) return false;
    const attrs = [
      node.getAttribute && node.getAttribute('aria-selected'),
      node.getAttribute && node.getAttribute('aria-checked'),
      node.getAttribute && node.getAttribute('data-selected'),
      node.getAttribute && node.getAttribute('data-state'),
    ].map((v) => text(v).toLowerCase());
    if (attrs.some((v) => ['true', '1', 'selected', 'checked', 'active'].includes(v))) return true;
    return /(?:^|\s)(?:selected|active|checked)(?:\s|$)/i.test(text(node.className));
  }

  function clickVariantNode(node, kind) {
    if (!node) return false;
    try {
      if (typeof node.click === 'function') node.click();
      else if (typeof MouseEvent !== 'undefined') node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      else return false;
      if (kind === 'matrix') networkDiagnostics.matrix_resolver_clicks++; else networkDiagnostics.stock_resolver_clicks++;
      return true;
    } catch (e) {
      networkDiagnostics.stock_resolver_last_error = text(e && e.message);
      return false;
    }
  }

  async function waitForSkuStock(skuId, timeoutMs) {
    const deadline = Date.now() + Math.max(80, Number(timeoutMs || 350));
    do {
      const row = findWarmSkuRow(skuId);
      if (rowHasKnownStock(row)) return row;
      await new Promise((resolve) => setTimeout(resolve, 60));
    } while (Date.now() < deadline);
    return findWarmSkuRow(skuId);
  }

  async function resolveMissingSkuStock(payload, options) {
    const opts = options || {};
    if (!payload || !Array.isArray(payload.combinations) || !payload.combinations.length) return payload;
    const unresolved = payload.combinations.filter((row) => row && row.supplier_sku_id && !rowHasKnownStock(row) && Array.isArray(row.attributes) && row.attributes.length);
    if (!unresolved.length) return payload;

    networkDiagnostics.stock_resolver_runs++;
    const maxAttempts = Math.max(1, Math.min(40, Number(opts.maxStockResolveSkus || 24)));
    const totalBudget = Math.max(800, Math.min(7000, Number(opts.stockResolveBudgetMs || 5200)));
    const perSkuWait = Math.max(120, Math.min(900, Number(opts.stockResolvePerSkuMs || 420)));
    const deadline = Date.now() + totalBudget;
    const selectedBefore = Array.from(document.querySelectorAll('[data-sku-col]')).filter(isLikelySelectedVariantNode);
    let attempted = 0;
    let resolved = 0;

    for (const row of unresolved.slice(0, maxAttempts)) {
      if (Date.now() >= deadline) { networkDiagnostics.stock_resolver_timeouts++; break; }
      attempted++;
      networkDiagnostics.stock_resolver_attempted_skus++;
      let selectable = true;
      for (const attr of row.attributes) {
        const node = optionNodeForAttribute(attr);
        if (!node) { selectable = false; break; }
        if (!isLikelySelectedVariantNode(node)) {
          clickVariantNode(node);
          await new Promise((resolve) => setTimeout(resolve, 45));
        }
      }
      if (!selectable) continue;
      const remaining = Math.max(80, Math.min(perSkuWait, deadline - Date.now()));
      const enriched = await waitForSkuStock(row.supplier_sku_id, remaining);
      if (rowHasKnownStock(enriched)) {
        resolved++;
        networkDiagnostics.stock_resolver_resolved_skus++;
      }
    }

    // Restore the user's visible selection best-effort. This is UI state only; it never changes
    // supplier SKU identity and does not add anything to the cart.
    for (const node of selectedBefore) {
      if (Date.now() >= deadline + 600) break;
      if (!isLikelySelectedVariantNode(node)) {
        clickVariantNode(node);
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
    }

    const merged = mergeSkuPayload(payload, warmSkuPayload);
    merged.diagnostics = addStockDiagnostics(mergeNetworkDiagnostics(Object.assign({}, merged.diagnostics || {}, {
      stock_resolver_attempted_this_run: attempted,
      stock_resolver_resolved_this_run: resolved,
      stock_resolver_budget_ms: totalBudget,
      stock_resolver_max_skus: maxAttempts,
    })), merged.combinations || []);
    return merged;
  }

  function mergeSkuPayload(base, incoming) {
    if (!base) {
      if (incoming) { incoming.diagnostics = addStockDiagnostics(mergeNetworkDiagnostics(incoming.diagnostics || {}), incoming.combinations || []); addMatrixDiagnostics(incoming.diagnostics, incoming); }
      return incoming;
    }
    if (!incoming) {
      base.diagnostics = addStockDiagnostics(mergeNetworkDiagnostics(base.diagnostics || {}), base.combinations || []); addMatrixDiagnostics(base.diagnostics, base);
      return base;
    }
    const merged = Object.assign({}, base);
    if ((!merged.dimensions || !merged.dimensions.length) && incoming.dimensions && incoming.dimensions.length) merged.dimensions = incoming.dimensions;
    const bySku = new Map();
    for (const row of Array.isArray(base.combinations) ? base.combinations : []) {
      if (row && row.supplier_sku_id) bySku.set(String(row.supplier_sku_id), Object.assign({}, row));
    }
    for (const row of Array.isArray(incoming.combinations) ? incoming.combinations : []) {
      if (!row || !row.supplier_sku_id) continue;
      const key = String(row.supplier_sku_id);
      const previous = bySku.get(key) || {};
      const next = Object.assign({}, previous, row);
      // Never lose a verified price/mapping just because a later stock payload is partial.
      if ((!row.supplier_price || !(number(row.supplier_price.amount) > 0)) && previous.supplier_price) next.supplier_price = previous.supplier_price;
      if ((!row.attributes || !row.attributes.length) && previous.attributes) next.attributes = previous.attributes;
      if (!row.sku_attr && previous.sku_attr) next.sku_attr = previous.sku_attr;
      if (row.stock_qty == null && previous.stock_qty != null) { next.stock_qty = previous.stock_qty; next.stock = previous.stock_qty; }
      if ((!row.stock_status || row.stock_status === 'unknown') && previous.stock_status) next.stock_status = previous.stock_status;
      if (row.available == null && previous.available != null) next.available = previous.available;
      bySku.set(key, next);
    }
    merged.combinations = Array.from(bySku.values());
    merged.source = incoming.source || base.source;
    merged.captured_at = incoming.captured_at || base.captured_at || new Date().toISOString();
    merged.diagnostics = addStockDiagnostics(mergeNetworkDiagnostics(Object.assign({}, base.diagnostics || {}, incoming.diagnostics || {})), merged.combinations);
    addMatrixDiagnostics(merged.diagnostics, merged);
    return merged;
  }

  function mergeNetworkDiagnostics(target) {
    const out = target || {};
    for (const [key, value] of Object.entries(networkDiagnostics)) {
      if (Array.isArray(value)) out[key] = value.slice();
      else if (typeof value === 'number') out[key] = Math.max(Number(out[key] || 0), value);
      else out[key] = value;
    }
    return out;
  }

  function rememberNetworkUrl(url) {
    const label = networkUrlLabel(url);
    if (!label || networkDiagnostics.network_candidate_urls.includes(label)) return;
    networkDiagnostics.network_candidate_urls.push(label);
    if (networkDiagnostics.network_candidate_urls.length > 8) networkDiagnostics.network_candidate_urls.shift();
  }

  function networkUrlLabel(url) {
    try {
      const parsed = new URL(String(url || ''), location && location.href ? location.href : undefined);
      return parsed.host + parsed.pathname;
    } catch (e) { return ''; }
  }

  function isAliNetworkUrl(url) {
    try {
      const parsed = new URL(String(url || ''), location && location.href ? location.href : undefined);
      const host = parsed.hostname.toLowerCase();
      return host === 'aliexpress.com' || host.endsWith('.aliexpress.com') || host.endsWith('.aliexpress.us') || host.endsWith('.aliexpress.ru') || host.endsWith('.alicdn.com') || host.endsWith('.alibaba.com') || host.endsWith('.aliexpress-media.com');
    } catch (e) { return false; }
  }

  function parseLocalizedAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const raw = text(value);
    if (!raw) return null;
    const match = raw.match(/[-+]?\d[\d\s.,'’]*/);
    if (!match) return null;
    let token = match[0].replace(/[\s'’]/g, '');
    const comma = token.lastIndexOf(',');
    const dot = token.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? ',' : '.';
      const thousands = decimal === ',' ? /\./g : /,/g;
      token = token.replace(thousands, '').replace(decimal, '.');
    } else if (comma >= 0) {
      const tail = token.length - comma - 1;
      token = tail === 1 || tail === 2 ? token.replace(',', '.') : token.replace(/,/g, '');
    } else if (dot >= 0) {
      const tail = token.length - dot - 1;
      if (!(tail === 1 || tail === 2)) token = token.replace(/\./g, '');
    }
    const n = parseFloat(token);
    return Number.isFinite(n) ? n : null;
  }

  function currencyFromPriceInfo(info, fallback) {
    if (!info || typeof info !== 'object') return text(fallback);
    const nested = [info.salePrice, info.activityPrice, info.currentPrice, info.originalPrice, info.price];
    for (const item of nested) {
      if (item && typeof item === 'object') {
        const c = text(item.currency || item.currencyCode);
        if (c) return c;
      }
    }
    return text(info.currency || info.currencyCode || fallback);
  }

  function currentPriceFromInfo(info) {
    if (!info || typeof info !== 'object') return null;
    const directObjects = [info.salePrice, info.activityPrice, info.currentPrice, info.targetSkuPriceInfo, info.price];
    for (const obj of directObjects) {
      if (!obj || typeof obj !== 'object') continue;
      const n = number(obj.value ?? obj.amount ?? obj.price);
      if (n != null && n > 0) return n;
      const s = parseLocalizedAmount(obj.salePriceString ?? obj.formatedAmount ?? obj.formattedAmount);
      if (s != null && s > 0) return s;
    }
    // salePriceLocal is intentionally NOT parsed. Current AliExpress values such as
    // "$9.80|9|80" are unsafe to feed into a generic amount parser.
    const safeStrings = [info.salePriceString, info.activityPriceString, info.currentPriceString, info.formatedActivityPrice, info.formattedActivityPrice];
    for (const candidate of safeStrings) {
      const n = parseLocalizedAmount(candidate);
      if (n != null && n > 0) return n;
    }
    const direct = number(info.salePrice ?? info.activityPrice ?? info.currentPrice ?? info.value ?? info.amount);
    if (direct != null && direct > 0) return direct;
    const original = info.originalPrice && typeof info.originalPrice === 'object' ? number(info.originalPrice.value ?? info.originalPrice.amount) : number(info.originalPrice);
    return original != null && original > 0 ? original : null;
  }


  function isPdpAdjustUrl(url) {
    return /(?:^|\.)mtop\.aliexpress\.pdp\.pc\.adjust(?:\/|$)/i.test(text(url)) || /pdp\.pc\.adjust/i.test(text(url));
  }

  function matrixContextAttributes(context) {
    const missing = context && context.missing ? context.missing : {};
    return [{
      property_id: text(missing.property_id),
      value_id: text(missing.value_id),
      name: text(missing.dimension),
      value: text(missing.label),
    }];
  }

  function candidateSkuId(value, keyHint) {
    if (!value || typeof value !== 'object') return '';
    const direct = text(value.skuId ?? value.sku_id ?? value.skuIdStr ?? value.skuCode ?? value.offerId ?? value.itemSkuId);
    if (direct) return direct;
    const key = text(keyHint);
    if (/^\d{5,}$/.test(key)) return key;
    return '';
  }

  function deepPdpAdjustRow(parts, keyHint, propertyMap) {
    const inputs = Array.isArray(parts) ? parts.filter((item) => item && typeof item === 'object') : [];
    if (!inputs.length) return null;
    let skuId = '', rawAttrs = '', price = null, currency = '', stock = { qty: null, available: null, status: 'unknown' };
    const queue = inputs.map((value) => ({ value, depth: 0 }));
    const seen = new WeakSet();
    let visited = 0;
    while (queue.length && visited < 1200) {
      const item = queue.shift();
      const value = item.value;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value); visited++;
      if (!skuId) skuId = candidateSkuId(value, item.depth === 0 ? keyHint : '');
      const attrs = rawAttrFromObject(value);
      if (attrs && attrs.length > rawAttrs.length) rawAttrs = attrs;
      const p = currentPriceFromInfo(value);
      if (p != null && p > 0 && price == null) { price = p; currency = currencyFromPriceInfo(value, currency); }
      const st = stockInfo(value);
      if ((stock.qty == null && st.qty != null) || (stock.status === 'unknown' && st.status !== 'unknown')) stock = st;
      if (item.depth < 5) {
        let children = [];
        try { children = Object.values(value); } catch (e) {}
        for (const child of children) if (child && typeof child === 'object' && !(typeof Node !== 'undefined' && child instanceof Node)) queue.push({ value: child, depth: item.depth + 1 });
      }
    }
    if (!skuId) return null;
    if (!rawAttrs && /[:;,]/.test(text(keyHint))) rawAttrs = text(keyHint);
    const parsedAttrs = parseSkuAttr(rawAttrs, propertyMap);
    const attributes = parsedAttrs.map((attr) => {
      const mapped = propertyMap.get(String(attr.property_id));
      const mappedValue = mapped && mapped.valueMap.get(String(attr.value_id));
      return { property_id: attr.property_id, value_id: attr.value_id, name: mapped ? mapped.dimension.name : '', value: mappedValue ? mappedValue.label : attr.fallback_label };
    }).filter((attr) => attr.property_id || attr.value_id || attr.value);
    return {
      supplier_sku_id: skuId,
      sku_attr: rawAttrs,
      attributes,
      supplier_price: price == null ? null : { amount: price, currency, kind: 'pdp-adjust' },
      supplier_regular_price: null,
      stock: stock.qty,
      stock_qty: stock.qty,
      stock_status: stock.status,
      available: stock.available,
    };
  }

  function collectPdpAdjustSkuCandidates(root, context) {
    const rows = new Map();
    const selectedIds = new Set();
    const skuPathIds = new Set();
    const paths = [];
    if (!root || typeof root !== 'object') return { rows: [], selectedIds: [], paths: [] };
    const dimensions = context && Array.isArray(context.dimensions) ? context.dimensions : [];
    const propertyMap = propertyMapForDimensions(dimensions);
    const queue = [{ value: root, depth: 0, path: 'network', keyHint: '' }];
    const seen = new WeakSet();
    let visited = 0;

    const rememberRow = (row, path) => {
      if (!row || !row.supplier_sku_id) return;
      const skuId = text(row.supplier_sku_id);
      const previous = rows.get(skuId) || { supplier_sku_id: skuId, sku_attr: '', attributes: [], supplier_price: null, supplier_regular_price: null, stock: null, stock_qty: null, stock_status: 'unknown', available: null };
      const next = Object.assign({}, previous);
      if (row.sku_attr && (!next.sku_attr || row.sku_attr.length > next.sku_attr.length)) next.sku_attr = row.sku_attr;
      if ((row.attributes || []).length > (next.attributes || []).length) next.attributes = row.attributes;
      if (row.supplier_price && number(row.supplier_price.amount) > 0) next.supplier_price = row.supplier_price;
      if (row.supplier_regular_price && number(row.supplier_regular_price.amount) > 0) next.supplier_regular_price = row.supplier_regular_price;
      if (row.stock_qty != null || (row.stock_status && row.stock_status !== 'unknown') || row.available != null) {
        next.stock = row.stock_qty; next.stock_qty = row.stock_qty; next.stock_status = row.stock_status || 'unknown'; next.available = row.available;
      }
      rows.set(skuId, next);
      if (path && (/\.SKU\.skuPaths(?:\.|$)/i.test(path) || /\.skuPaths(?:\.|$)/i.test(path))) { paths.push(path); skuPathIds.add(skuId); }
    };

    while (queue.length && visited < 18000) {
      const item = queue.shift();
      const value = item.value;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value); visited++;
      const generic = deepPdpAdjustRow([value], item.keyHint, propertyMap);
      if (generic) {
        rememberRow(generic, item.path);
        const selectedFlag = bool(value.selected ?? value.isSelected ?? value.active ?? value.isActive ?? value.current ?? value.isCurrent ?? value.checked);
        if (selectedFlag === true) selectedIds.add(text(generic.supplier_sku_id));
      }
      let entries = [];
      try { entries = Object.entries(value); } catch (e) { continue; }
      for (const [key, child] of entries) {
        const path = item.path + '.' + key;
        if ((/(?:current|selected|active|target).*(?:sku).*(?:id)/i.test(key) || /(?:sku).*(?:current|selected|active|target).*(?:id)/i.test(key)) && (typeof child === 'string' || typeof child === 'number')) {
          const id = text(child); if (id) selectedIds.add(id);
        }

        // Current AliExpress adjust responses commonly split one SKU row across sibling maps
        // (for example SKU.skuPaths[index], a price map and an inventory map). Join siblings by
        // the same path/index before deciding whether the selected row is complete.
        if (/^skuPaths$/i.test(key) && child && typeof child === 'object') {
          let pathEntries = [];
          try { pathEntries = Object.entries(child); } catch (e) {}
          for (const [entryKey, entryValue] of pathEntries) {
            const siblingParts = [entryValue];
            for (const [siblingKey, siblingValue] of entries) {
              if (siblingKey === key || !siblingValue || typeof siblingValue !== 'object') continue;
              try {
                if (Object.prototype.hasOwnProperty.call(siblingValue, entryKey) && siblingValue[entryKey] && typeof siblingValue[entryKey] === 'object') siblingParts.push(siblingValue[entryKey]);
              } catch (e) {}
            }
            const joined = deepPdpAdjustRow(siblingParts, entryKey, propertyMap);
            if (joined) rememberRow(joined, path + '.' + entryKey);
          }
        }

        if (child && typeof child === 'object') {
          if (item.depth < 12 && !(typeof Node !== 'undefined' && child instanceof Node)) queue.push({ value: child, depth: item.depth + 1, path, keyHint: key });
        }
      }
    }
    // A number of current pdp.pc.adjust payloads expose skuId/price/stock in one map and
    // the complete property path in another subtree. Reconcile those structures by skuId before
    // deciding that a real SKU is unmapped.
    const skuIds = new Set(rows.keys());
    const discoveredMappings = findSkuMappings(root, skuIds, 12);
    for (const [skuId, rawAttrs] of discoveredMappings.entries()) {
      const current = rows.get(skuId);
      if (!current) continue;
      const parsedAttrs = parseSkuAttr(rawAttrs, propertyMap);
      const attributes = parsedAttrs.map((attr) => {
        const mapped = propertyMap.get(String(attr.property_id));
        const mappedValue = mapped && mapped.valueMap.get(String(attr.value_id));
        return { property_id: attr.property_id, value_id: attr.value_id, name: mapped ? mapped.dimension.name : '', value: mappedValue ? mappedValue.label : attr.fallback_label };
      }).filter((attr) => attr.property_id || attr.value_id || attr.value);
      if (attributes.length > (current.attributes || []).length) current.attributes = attributes;
      if (rawAttrs && (!current.sku_attr || rawAttrs.length > current.sku_attr.length)) current.sku_attr = rawAttrs;
      rows.set(skuId, current);
    }
    const finalRows = Array.from(rows.values());
    return { rows: finalRows, selectedIds: Array.from(selectedIds), paths: Array.from(new Set(paths)).slice(0, 16), mappedSkuIds: Array.from(discoveredMappings.keys()), skuPathIds: Array.from(skuPathIds) };
  }

  function normalizePdpAdjustPayload(root, source, diagnostics, context) {
    if (!context || !context.missing || !root || typeof root !== 'object') return null;
    const found = collectPdpAdjustSkuCandidates(root, context);
    if (!found.rows.length) return null;
    const knownBefore = new Set(Array.isArray(context.knownBefore) ? context.knownBefore.map(text) : []);
    const missing = context.missing;
    let rows = found.rows.filter((row) => row && row.supplier_sku_id);
    const directMatches = rows.filter((row) => rowMatchesMatrixValue(row, missing) && rowHasVerifiedSkuPrice(row));
    let selected = directMatches.length === 1 ? directMatches[0] : null;

    if (!selected && Array.isArray(found.selectedIds) && found.selectedIds.length) {
      const current = rows.filter((row) => found.selectedIds.includes(text(row.supplier_sku_id)) && rowHasVerifiedSkuPrice(row));
      if (current.length === 1) selected = current[0];
    }

    if (!selected && context.allowSelectedInference) {
      const fresh = rows.filter((row) => rowHasVerifiedSkuPrice(row) && !knownBefore.has(text(row.supplier_sku_id)));
      if (fresh.length === 1) selected = fresh[0];
    }

    if (selected && !rowMatchesMatrixValue(selected, missing) && context.allowSelectedInference) {
      selected = Object.assign({}, selected, { attributes: matrixContextAttributes(context) });
      if (!selected.sku_attr) selected.sku_attr = `${text(missing.property_id)}:${text(missing.value_id)}#${text(missing.label)}`;
      rows = rows.map((row) => text(row.supplier_sku_id) === text(selected.supplier_sku_id) ? selected : row);
      networkDiagnostics.matrix_adjust_inferred_rows++;
    }

    const verifiedCandidateRows = rows.filter((row) => rowHasVerifiedSkuPrice(row));
    const fullPathRows = verifiedCandidateRows.filter((row) => rowHasFullDimensionPath(row, context.dimensions || []));
    const unmappedRows = verifiedCandidateRows.filter((row) => !rowHasFullDimensionPath(row, context.dimensions || []));
    // Rows without a full attribute mapping are never promoted into the matrix. On multi-
    // dimensional products this is a real unresolved SKU-path problem, not a missing option.
    rows = fullPathRows;
    if (!rows.length) return null;

    diagnostics = diagnostics || {};
    diagnostics.pdp_adjust_candidate_rows = found.rows.length;
    diagnostics.pdp_adjust_mapped_rows = rows.length;
    diagnostics.pdp_adjust_unmapped_rows = unmappedRows.length;
    diagnostics.pdp_adjust_unmapped_sku_ids = unmappedRows.map((row) => text(row.supplier_sku_id)).filter(Boolean).slice(0, 16);
    diagnostics.pdp_adjust_sku_path_rows = found.skuPathIds ? found.skuPathIds.length : 0;
    diagnostics.pdp_adjust_selected_sku_id = selected ? text(selected.supplier_sku_id) : '';
    diagnostics.pdp_adjust_sku_paths = found.paths;
    networkDiagnostics.matrix_adjust_candidate_rows = Math.max(networkDiagnostics.matrix_adjust_candidate_rows, found.rows.length);
    networkDiagnostics.matrix_adjust_sku_path_rows = Math.max(networkDiagnostics.matrix_adjust_sku_path_rows, found.skuPathIds ? found.skuPathIds.length : 0);
    networkDiagnostics.matrix_adjust_full_path_rows = Math.max(networkDiagnostics.matrix_adjust_full_path_rows, rows.length);
    networkDiagnostics.matrix_adjust_unmapped_rows = Math.max(networkDiagnostics.matrix_adjust_unmapped_rows, unmappedRows.length);
    if (selected) networkDiagnostics.matrix_adjust_context_matches++;
    addStockDiagnostics(diagnostics, rows);
    return {
      source: source + ':contextual-adjust',
      dimensions: Array.isArray(context.dimensions) ? context.dimensions : [],
      combinations: rows,
      diagnostics,
      captured_at: new Date().toISOString(),
    };
  }

  function parseNetworkJson(textValue) {
    const raw = textValue == null ? '' : String(textValue).trim();
    if (!raw || raw.length > 5 * 1024 * 1024) return null;
    const cleaned = raw.replace(/^\)\]}'\s*/, '').trim();
    try { return JSON.parse(cleaned); } catch (e) {}
    const match = cleaned.match(/^[A-Za-z_$][\w$.[\]]*\s*\((([\s\S])*?)\)\s*;?$/);
    if (match) {
      try { return JSON.parse(match[1]); } catch (e) {}
    }
    return null;
  }

  function embeddedJsonObjects(root, maxDepth) {
    const result = [];
    if (!root || typeof root !== 'object') return result;
    const queue = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let visited = 0;
    while (queue.length && visited < 5000 && result.length < 24) {
      const item = queue.shift();
      const value = item.value;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value); visited++;
      let keys = [];
      try { keys = Object.keys(value); } catch (e) { continue; }
      for (const key of keys) {
        let child;
        try { child = value[key]; } catch (e) { continue; }
        if (typeof child === 'string' && child.length >= 20 && child.length <= 2 * 1024 * 1024 && /^[\s]*[\[{]/.test(child) && /(?:sku|price|description|product)/i.test(child)) {
          try {
            const parsed = JSON.parse(child);
            if (parsed && typeof parsed === 'object') result.push({ value: parsed, key });
          } catch (e) {}
        } else if (child && typeof child === 'object' && item.depth < maxDepth) {
          if (typeof Node !== 'undefined' && child instanceof Node) continue;
          queue.push({ value: child, depth: item.depth + 1 });
        }
      }
    }
    return result;
  }

  function looksLikeSkuModule(value) {
    if (!value || typeof value !== 'object') return false;
    const rows = value.skuPriceList || value.skuList || value.skuMap || value.skuPrices || value.skus;
    const props = value.productSKUPropertyList || value.skuPropertyList || value.skuProps || value.productSkuProperties || value.properties;
    return asRecords(rows).length > 0 && asRecords(props).length > 0;
  }

  function findSkuContainerInObject(root, maxDepth, startPath) {
    if (!root || typeof root !== 'object') return null;
    const queue = [{ value: root, depth: 0, path: startPath || '' }];
    const seen = new WeakSet();
    let visited = 0;
    while (queue.length && visited < 9000) {
      const item = queue.shift();
      const value = item.value;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value); visited++;

      if (looksLikeSkuModule(value.skuModule)) {
        return { module: value.skuModule, path: item.path ? item.path + '.skuModule' : 'skuModule', visited };
      }
      if (looksLikeSkuModule(value.skuInfo)) {
        return { module: value.skuInfo, path: item.path ? item.path + '.skuInfo' : 'skuInfo', visited };
      }
      if (looksLikeSkuModule(value)) return { module: value, path: item.path || 'skuModule', visited };

      if (item.depth >= maxDepth) continue;
      let keys = [];
      try { keys = Object.keys(value); } catch (e) { continue; }
      for (const key of keys) {
        if (/^(?:window|document|parent|top|self|frames|globalThis|localStorage|sessionStorage)$/i.test(key)) continue;
        let child;
        try { child = value[key]; } catch (e) { continue; }
        if (!child || typeof child !== 'object') continue;
        if (typeof Node !== 'undefined' && child instanceof Node) continue;
        queue.push({ value: child, depth: item.depth + 1, path: item.path ? item.path + '.' + key : key });
      }
    }
    return null;
  }

  function runtimeRoots() {
    const roots = [];
    const add = (name, value) => { if (value && typeof value === 'object') roots.push([name, value]); };
    add('runParams.data', window.runParams && window.runParams.data);
    add('runParams', window.runParams);
    add('__INIT_DATA__', window.__INIT_DATA__);
    add('__INITIAL_STATE__', window.__INITIAL_STATE__);
    add('__PRELOADED_STATE__', window.__PRELOADED_STATE__);
    add('__SSR_DATA__', window.__SSR_DATA__);
    add('__NEXT_DATA__', window.__NEXT_DATA__);
    add('productDetail', window.productDetail);
    add('productData', window.productData);

    // AliExpress changes global names regularly. Inspect only likely object globals,
    // rather than recursively walking the entire window object.
    let names = [];
    try { names = Object.getOwnPropertyNames(window); } catch (e) {}
    for (const name of names) {
      if (!/(?:sku|product|detail|init|state|data|runparam)/i.test(name)) continue;
      if (roots.some((r) => r[0] === name)) continue;
      let value;
      try { value = window[name]; } catch (e) { continue; }
      add('window.' + name, value);
      if (roots.length >= 80) break;
    }
    return roots;
  }


  function locateSkuModuleInRuntime(diagnostics) {
    const roots = runtimeRoots();
    diagnostics.runtime_roots_checked = Math.max(Number(diagnostics.runtime_roots_checked || 0), roots.length);
    for (const [name, root] of roots) {
      const found = findSkuContainerInObject(root, 10, name);
      if (found) {
        diagnostics.runtime_objects_visited = (diagnostics.runtime_objects_visited || 0) + (found.visited || 0);
        return { module: found.module, source: found.path || name };
      }
    }
    return null;
  }

  function looksLikeDescriptionHtml(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed.length < 40) return false;
    return /<(?:div|p|img|table|ul|ol|section|span|br)\b/i.test(trimmed);
  }

  function decodeDescriptionHtml(value) {
    let textValue = value == null ? '' : String(value).trim();
    if (!textValue) return '';
    // JSON.parse already resolves \u003c / escaped quotes. Some AliExpress payloads still
    // transport HTML entities inside generic `data` fields, so decode only the small set
    // required to recognize markup without executing it.
    if (/&(?:lt|gt|quot|amp|#39);/i.test(textValue)) {
      textValue = textValue
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, '&');
    }
    return textValue.trim();
  }

  function descriptionPlainText(html) {
    return String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function descriptionRejectReason(html) {
    const t = descriptionPlainText(html).toLowerCase();
    if (!t) return '';
    const blocked = [
      /\barticle\(s\) dans votre panier\b/,
      /\barticles? dans (?:votre|le) panier\b/,
      /\bshopping cart\b/,
      /\bcart items?\b/,
      /\bwarenkorb\b/,
      /\bcheckout\b/,
      /\bpaiement\b/,
      /\bpayment\b/,
    ];
    for (const re of blocked) if (re.test(t)) return re.source;
    return '';
  }

  function descriptionCandidateScore(path, html, urlHint) {
    const p = String(path || '');
    const u = String(urlHint || '');
    const h = String(html || '');
    const textValue = descriptionPlainText(h);
    let score = 0;
    if (/(?:description|desc|detail)/i.test(p)) score += 120;
    if (/(?:description|desc|detail)/i.test(u)) score += 90;
    if (/(?:detail-desc-decorate-richtext|detailmodule_html|product-description|description--content|ProductDescription|extend--content--)/i.test(h)) score += 120;
    if (/<img[\s>]/i.test(h)) score += 18;
    if (/<(?:table|ul|ol)[\s>]/i.test(h)) score += 12;
    if (textValue.length >= 150) score += 15;
    if (textValue.length >= 500) score += 20;
    if (h.length >= 2500) score += 22;
    if (/(?:param(?:è|e)tre|caract(?:é|e)ristiques|specification|beschreibung|description|présentation)/i.test(textValue)) score += 20;
    if (/(?:review|recommend|footer|header|breadcrumb|coupon|shipping|seller|promotion|sku|price)/i.test(p)) score -= 100;
    if (descriptionRejectReason(h)) score -= 1000;
    return score;
  }

  function findDescriptionInObject(root, maxDepth, startPath, options) {
    if (!root || typeof root !== 'object') return null;
    const opts = options || {};
    const queue = [{ value: root, depth: 0, path: startPath || '' }];
    const seen = new WeakSet();
    let visited = 0;
    const urlKeys = /^(?:descriptionUrl|descriptionURL|descUrl|detailUrl|descriptionJsonUrl|descriptionJSONUrl|descriptioninJsonUrl|descriptionInJsonUrl|detailDescUrl)$/i;
    const htmlKeys = /(?:descriptionHtml|descriptionHTML|detailHtml|detailHTML|productDescriptionHtml|productDescHtml|detailDesc|descriptionContent|detailContent)$/i;
    let urlCandidate = null;
    let bestHtml = null;
    while (queue.length && visited < 9000) {
      const item = queue.shift();
      const value = item.value;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value); visited++;
      let keys = [];
      try { keys = Object.keys(value); } catch (e) { continue; }
      for (const key of keys) {
        let child;
        try { child = value[key]; } catch (e) { continue; }
        const path = item.path ? item.path + '.' + key : key;
        if (typeof child === 'string') {
          const decoded = decodeDescriptionHtml(child);
          if (!urlCandidate && urlKeys.test(key) && /^https?:\/\//i.test(decoded)) {
            urlCandidate = { url: decoded, source: path };
          }
          if (looksLikeDescriptionHtml(decoded)) {
            const score = descriptionCandidateScore(path, decoded, opts.urlHint);
            if ((htmlKeys.test(key) || /^(?:description|desc|detailDescription)$/i.test(key)) && score >= 80) {
              return { html: decoded, source: path, url: urlCandidate, visited, score: Math.max(score, 160) };
            }
            // Generic `data`/`result` is a last-resort path only. It must carry strong
            // description context and pass the false-positive rejection rules (cart/payment/etc.).
            if (score >= 150 && (!bestHtml || score > bestHtml.score || (score === bestHtml.score && decoded.length > bestHtml.html.length))) {
              bestHtml = { html: decoded, source: path, url: urlCandidate, visited, score };
            }
          }
          continue;
        }
        if (child && typeof child === 'object' && item.depth < maxDepth) {
          if (typeof Node !== 'undefined' && child instanceof Node) continue;
          queue.push({ value: child, depth: item.depth + 1, path });
        }
      }
    }
    if (bestHtml) return bestHtml;
    return urlCandidate ? { html: '', source: null, url: urlCandidate, visited } : null;
  }


  function locateRuntimeDescription() {
    const roots = runtimeRoots();
    for (const [name, root] of roots) {
      const found = findDescriptionInObject(root, 9, name);
      if (found && (found.html || found.url)) return found;
    }
    return null;
  }

  function extractBalancedObject(source, braceIndex) {
    if (braceIndex < 0 || source[braceIndex] !== '{') return null;
    let depth = 0, quote = '', escaped = false;
    for (let i = braceIndex; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return source.slice(braceIndex, i + 1);
      }
    }
    return null;
  }

  function findSkuContainerInScripts(diagnostics) {
    const scripts = Array.from(document.scripts || []);
    diagnostics.scripts_scanned = scripts.length;
    diagnostics.sku_key_samples = diagnostics.sku_key_samples || [];
    diagnostics.scripts_with_sku_keyword = diagnostics.scripts_with_sku_keyword || 0;
    for (let index = 0; index < scripts.length; index++) {
      const raw = scripts[index].textContent || '';
      if (!raw) continue;
      if (/sku/i.test(raw)) {
        diagnostics.scripts_with_sku_keyword++;
        const keyRe = /["']?([A-Za-z_$][A-Za-z0-9_$]{0,60}sku[A-Za-z0-9_$]{0,60})["']?\s*[:=]/gi;
        let km;
        while ((km = keyRe.exec(raw)) && diagnostics.sku_key_samples.length < 30) {
          const key = km[1];
          if (key && !diagnostics.sku_key_samples.includes(key)) diagnostics.sku_key_samples.push(key);
        }
      }
      if (!/(?:skuPriceList|productSKUPropertyList|skuPropertyList|skuMap|skuPrices|"skuModule"|skuModule\s*:)/.test(raw)) continue;
      diagnostics.scripts_matched++;

      // JSON script / JSON-LD-like application state.
      try {
        const parsed = JSON.parse(raw);
        const found = findSkuContainerInObject(parsed, 10, `script[${index}]`);
        if (found) return { module: found.module, source: found.path || `script[${index}]` };
      } catch (e) {}

      // Common assignment containing a JSON-compatible "skuModule": { ... } object.
      const patterns = [/"skuModule"\s*:\s*\{/g, /skuModule\s*:\s*\{/g];
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(raw))) {
          const brace = raw.indexOf('{', match.index);
          const objectText = extractBalancedObject(raw, brace);
          if (!objectText) continue;
          try {
            const module = JSON.parse(objectText);
            if (looksLikeSkuModule(module)) return { module, source: `script[${index}].skuModule` };
            const found = findSkuContainerInObject(module, 6, `script[${index}].skuModule`);
            if (found) return { module: found.module, source: found.path };
          } catch (e) {}
        }
      }
    }
    return null;
  }

  function locateSkuModule(diagnostics) {
    return locateSkuModuleInRuntime(diagnostics) || findSkuContainerInScripts(diagnostics);
  }

  function normalizeProperties(module) {
    const props = asRecords(module.productSKUPropertyList || module.skuPropertyList || module.skuProps || module.productSkuProperties || module.properties);
    return props.map((prop) => {
      const propertyId = text(prop.skuPropertyId ?? prop.propertyId ?? prop.id);
      const name = text(prop.skuPropertyName ?? prop.propertyName ?? prop.name);
      const values = asRecords(prop.skuPropertyValues || prop.propertyValues || prop.values || prop.options).map((value) => ({
        value_id: text(value.propertyValueId ?? value.skuPropertyValueId ?? value.valueId ?? value.id),
        label: text(value.propertyValueDisplayName ?? value.propertyValueDefinitionName ?? value.propertyValueName ?? value.skuPropertyValue ?? value.valueName ?? value.name),
        image_url: text(value.skuPropertyImagePath ?? value.skuPropertyImageSummPath ?? value.propertyValueImage ?? value.imageUrl ?? value.image),
      })).filter((value) => value.value_id || value.label);
      return { property_id: propertyId, name, values };
    }).filter((prop) => prop.property_id || prop.name);
  }

  function parseSkuAttr(raw, propertyMap) {
    const source = text(raw);
    if (!source) return [];

    // Preferred AliExpress encoding: "14:193#Black;5:100014064#US".
    // Some builds separate pairs by commas instead of semicolons.
    const attrs = [];
    const pairRe = /([^:;,\s]+)\s*:\s*([^#;,\s]+)(?:#([^;,]+))?/g;
    let match;
    while ((match = pairRe.exec(source))) {
      attrs.push({
        property_id: text(match[1]),
        value_id: text(match[2]),
        fallback_label: text(match[3] || ''),
      });
    }
    if (attrs.length) return attrs;

    // Alternative observed in current AliExpress code: skuPropIds can be only the
    // property-value IDs, comma separated. Resolve each value id against the property lists.
    const ids = source.split(/[;,]/).map((part) => text(part)).filter(Boolean);
    if (!ids.length || !propertyMap) return [];
    for (const valueId of ids) {
      for (const [propertyId, mapped] of propertyMap.entries()) {
        if (mapped && mapped.valueMap && mapped.valueMap.has(String(valueId))) {
          const value = mapped.valueMap.get(String(valueId));
          attrs.push({
            property_id: String(propertyId),
            value_id: String(valueId),
            fallback_label: value ? text(value.label) : '',
          });
          break;
        }
      }
    }
    return attrs;
  }

  function amountObject(val, keys) {
    for (const key of keys) {
      const obj = val && val[key];
      if (obj && typeof obj === 'object' && number(obj.value ?? obj.amount ?? obj.price) != null) return obj;
      if (number(obj) != null) return { value: obj };
    }
    return null;
  }

  function normalizeSkuData(module, source, diagnostics) {
    const dimensions = normalizeProperties(module);
    const propertyMap = new Map();
    dimensions.forEach((dimension) => {
      const valueMap = new Map();
      dimension.values.forEach((value) => valueMap.set(String(value.value_id), value));
      propertyMap.set(String(dimension.property_id), { dimension, valueMap });
    });

    const rows = asRecords(module.skuPriceList || module.skuList || module.skuMap || module.skuPrices || module.skus);
    diagnostics.sku_rows_found = rows.length;
    diagnostics.dimension_count = dimensions.length;
    const combinations = [];
    for (const sku of rows) {
      if (!sku || typeof sku !== 'object') continue;
      const val = sku.skuVal && typeof sku.skuVal === 'object' ? sku.skuVal : sku;
      const activityCandidate = amountObject(val, ['skuActivityAmount', 'activityAmount', 'salePrice', 'discountPrice', 'actSkuPrice']);
      const activity = activityCandidate && number(activityCandidate.value ?? activityCandidate.amount ?? activityCandidate.price) > 0 ? activityCandidate : null;
      const regular = amountObject(val, ['skuAmount', 'amount', 'price', 'skuPrice']);
      const chosen = activity || regular;
      const price = chosen ? number(chosen.value ?? chosen.amount ?? chosen.price) : null;
      const regularPrice = regular ? number(regular.value ?? regular.amount ?? regular.price) : price;
      const currency = text((chosen && (chosen.currency || chosen.currencyCode)) || (regular && (regular.currency || regular.currencyCode)) || val.currency || val.currencyCode);
      const stockMeta = stockInfo(val, sku);
      const rawAttrs = sku.skuAttr ?? sku.skuAttrs ?? sku.skuPropIds ?? sku.propPath ?? sku.attributes;
      const parsedAttrs = parseSkuAttr(rawAttrs, propertyMap);
      const attributes = parsedAttrs.map((attr) => {
        const mapped = propertyMap.get(String(attr.property_id));
        const mappedValue = mapped && mapped.valueMap.get(String(attr.value_id));
        return { property_id: attr.property_id, value_id: attr.value_id, name: mapped ? mapped.dimension.name : '', value: mappedValue ? mappedValue.label : attr.fallback_label };
      }).filter((attr) => attr.property_id || attr.value_id || attr.value);
      combinations.push({
        supplier_sku_id: text(sku.skuId ?? sku.id ?? sku.sku_id ?? sku.skuCode ?? sku.skuIdStr),
        sku_attr: text(rawAttrs ?? ''),
        attributes,
        supplier_price: price == null ? null : { amount: price, currency, kind: activity ? 'activity' : 'regular' },
        supplier_regular_price: regularPrice == null ? null : { amount: regularPrice, currency },
        // `stock` is kept for backward compatibility. `stock_qty`/`stock_status` are the
        // monitoring contract and preserve unknown quantity separately from a real zero.
        stock: stockMeta.qty,
        stock_qty: stockMeta.qty,
        stock_status: stockMeta.status,
        available: stockMeta.available,
      });
    }
    diagnostics.priced_rows = combinations.filter((row) => row.supplier_price && number(row.supplier_price.amount) > 0).length;
    diagnostics.mapped_rows = combinations.filter((row) => row.attributes && row.attributes.length).length;
    addStockDiagnostics(diagnostics, combinations);
    const payload = { source, dimensions, combinations, diagnostics, captured_at: new Date().toISOString() };
    addMatrixDiagnostics(diagnostics, payload);
    return payload;
  }


  function normalizeModernProperties(props) {
    return asRecords(props).map((prop) => {
      const propertyId = text(prop.skuPropertyId ?? prop.propertyId ?? prop.id);
      const name = text(prop.skuPropertyName ?? prop.propertyName ?? prop.name);
      const values = asRecords(prop.skuPropertyValues || prop.propertyValues || prop.values || prop.options).map((value) => ({
        value_id: text(value.propertyValueIdLong ?? value.propertyValueId ?? value.skuPropertyValueId ?? value.valueId ?? value.id),
        label: text(value.propertyValueDisplayName ?? value.propertyValueDefinitionName ?? value.propertyValueName ?? value.skuPropertyValue ?? value.valueName ?? value.name),
        image_url: text(value.skuPropertyImagePath ?? value.skuPropertyImageSummPath ?? value.propertyValueImage ?? value.imageUrl ?? value.image),
      })).filter((value) => value.value_id || value.label);
      return { property_id: propertyId, name, values };
    }).filter((prop) => prop.property_id || prop.name);
  }

  function propertyMapForDimensions(dimensions) {
    const map = new Map();
    for (const dimension of dimensions) {
      const valueMap = new Map();
      for (const value of dimension.values || []) valueMap.set(String(value.value_id), value);
      map.set(String(dimension.property_id), { dimension, valueMap });
    }
    return map;
  }

  function rawAttrFromObject(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const direct = obj.skuAttr ?? obj.skuAttrs ?? obj.skuPropIds ?? obj.propPath ?? obj.propertyPath ?? obj.skuPropertyIds ?? obj.skuPropertyValueIds ?? obj.attributesPath ?? obj.skuPath ?? obj.skuPropertyPath ?? obj.skuPropertyList ?? obj.attributes;
    if (typeof direct === 'string' || typeof direct === 'number') return text(direct);
    if (Array.isArray(direct)) {
      const pairs = [];
      const ids = [];
      for (const item of direct) {
        if (item && typeof item === 'object') {
          const propertyId = text(item.propertyId ?? item.property_id ?? item.skuPropertyId ?? item.pid ?? item.propId);
          const valueId = text(item.valueId ?? item.value_id ?? item.propertyValueId ?? item.skuPropertyValueId ?? item.vid ?? item.id);
          const label = text(item.value ?? item.label ?? item.name ?? item.propertyValueName ?? item.propertyValueDisplayName);
          if (propertyId && valueId) pairs.push(`${propertyId}:${valueId}${label ? '#' + label : ''}`);
          else if (valueId) ids.push(valueId);
        } else {
          const id = text(item); if (id) ids.push(id);
        }
      }
      if (pairs.length) return pairs.join(';');
      if (ids.length) return ids.join(',');
    }
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      const pairs = [];
      try {
        for (const [propertyId, value] of Object.entries(direct)) {
          if (!/^\d+$/.test(String(propertyId))) continue;
          const valueId = text(value && typeof value === 'object' ? (value.valueId ?? value.value_id ?? value.propertyValueId ?? value.id) : value);
          const label = text(value && typeof value === 'object' ? (value.value ?? value.label ?? value.name ?? value.propertyValueName) : '');
          if (valueId) pairs.push(`${propertyId}:${valueId}${label ? '#' + label : ''}`);
        }
      } catch (e) {}
      if (pairs.length) return pairs.join(';');
    }
    return '';
  }

  function findSkuMappings(root, skuIds, maxDepth) {
    const mappings = new Map();
    if (!root || typeof root !== 'object' || !skuIds || !skuIds.size) return mappings;
    const queue = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let visited = 0;
    const remember = (skuId, rawAttrs) => {
      const id = text(skuId);
      const attrs = text(rawAttrs);
      if (!id || !attrs || !skuIds.has(id) || mappings.has(id)) return;
      mappings.set(id, attrs);
    };
    while (queue.length && visited < 12000) {
      const item = queue.shift();
      const value = item.value;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value); visited++;

      const directId = text(value.skuId ?? value.sku_id ?? value.skuIdStr ?? value.skuCode);
      const directAttrs = rawAttrFromObject(value);
      if (directId && directAttrs) remember(directId, directAttrs);

      let keys = [];
      try { keys = Object.keys(value); } catch (e) { continue; }
      for (const key of keys) {
        let child;
        try { child = value[key]; } catch (e) { continue; }
        if (skuIds.has(String(key)) && child && typeof child === 'object') {
          const attrs = rawAttrFromObject(child);
          if (attrs) remember(String(key), attrs);
        }
        // Some AliExpress maps use a property path as the key and the skuId as value/object field.
        if (/[:;,]/.test(key) && /\d/.test(key)) {
          if (typeof child === 'string' || typeof child === 'number') remember(child, key);
          else if (child && typeof child === 'object') remember(child.skuId ?? child.sku_id ?? child.id, key);
        }
        if (child && typeof child === 'object' && item.depth < maxDepth) {
          if (typeof Node !== 'undefined' && child instanceof Node) continue;
          queue.push({ value: child, depth: item.depth + 1 });
        }
      }
    }
    return mappings;
  }

  function looksLikeSkuPriceMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    let entries = [];
    try { entries = Object.entries(value); } catch (e) { return false; }
    if (!entries.length || entries.length > 5000) return false;
    let priced = 0;
    for (const [key, item] of entries.slice(0, 12)) {
      if (!/^\d{5,}$/.test(String(key)) && !(item && typeof item === 'object' && text(item.skuId ?? item.sku_id))) continue;
      if (item && typeof item === 'object' && currentPriceFromInfo(item) != null) priced++;
    }
    return priced >= Math.min(2, entries.length);
  }

  function collectModernSkuParts(root) {
    if (!root || typeof root !== 'object') return null;
    const queue = [{ value: root, depth: 0, path: 'network' }];
    const seen = new WeakSet();
    let props = null, propsPath = '', priceMap = null, pricePath = '', quantityMap = null, quantityPath = '';
    let visited = 0;
    while (queue.length && visited < 12000) {
      const item = queue.shift();
      const value = item.value;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value); visited++;
      let keys = [];
      try { keys = Object.keys(value); } catch (e) { continue; }
      for (const key of keys) {
        let child;
        try { child = value[key]; } catch (e) { continue; }
        const path = item.path + '.' + key;
        if (!props && /^(?:skuProperties|productSKUPropertyList|skuPropertyList|skuProps|productSkuProperties)$/i.test(key) && asRecords(child).length) { props = child; propsPath = path; }
        if (!priceMap && /^(?:skuIdPrices|skuPriceInfoMap|skuPricesById|skuPriceMap)$/i.test(key) && child && typeof child === 'object') { priceMap = child; pricePath = path; }
        if (!quantityMap && /^(?:allSkuQuantity|skuQuantityMap|skuStockMap|skuInventoryMap|inventoryMap|skuAvailableQuantityMap|skuQuantityById|skuInventoryById)$/i.test(key) && child && typeof child === 'object') { quantityMap = child; quantityPath = path; }
        if (!priceMap && looksLikeSkuPriceMap(child)) { priceMap = child; pricePath = path; }
        if (child && typeof child === 'object' && item.depth < 10) {
          if (typeof Node !== 'undefined' && child instanceof Node) continue;
          queue.push({ value: child, depth: item.depth + 1, path });
        }
      }
    }
    if (!props || !priceMap) return null;
    return { props, propsPath, priceMap, pricePath, quantityMap, quantityPath, visited };
  }

  function normalizeModernSkuPayload(root, source, diagnostics) {
    const parts = collectModernSkuParts(root);
    if (!parts) return null;
    const dimensions = normalizeModernProperties(parts.props);
    const propertyMap = propertyMapForDimensions(dimensions);
    let priceEntries = [];
    try { priceEntries = Object.entries(parts.priceMap || {}); } catch (e) {}
    const skuIds = new Set();
    for (const [key, item] of priceEntries) {
      const id = text((item && typeof item === 'object' && (item.skuId ?? item.sku_id ?? item.id)) || key);
      if (id) skuIds.add(id);
    }
    const mappings = findSkuMappings(root, skuIds, 10);
    diagnostics.network_modern_price_rows = Math.max(Number(diagnostics.network_modern_price_rows || 0), priceEntries.length);
    diagnostics.network_mapping_rows = Math.max(Number(diagnostics.network_mapping_rows || 0), mappings.size);
    const combinations = [];
    for (const [key, info] of priceEntries) {
      if (!info || typeof info !== 'object') continue;
      const skuId = text(info.skuId ?? info.sku_id ?? info.id ?? key);
      if (!skuId) continue;
      const rawAttrs = rawAttrFromObject(info) || mappings.get(skuId) || '';
      const parsedAttrs = parseSkuAttr(rawAttrs, propertyMap);
      const attributes = parsedAttrs.map((attr) => {
        const mapped = propertyMap.get(String(attr.property_id));
        const mappedValue = mapped && mapped.valueMap.get(String(attr.value_id));
        return { property_id: attr.property_id, value_id: attr.value_id, name: mapped ? mapped.dimension.name : '', value: mappedValue ? mappedValue.label : attr.fallback_label };
      }).filter((attr) => attr.property_id || attr.value_id || attr.value);
      // A price without an unambiguous mapping to all detected dimensions is diagnostic only.
      if (!attributes.length || (dimensions.length && attributes.length < dimensions.length)) continue;
      const price = currentPriceFromInfo(info);
      const currency = currencyFromPriceInfo(info, '');
      const q = parts.quantityMap && parts.quantityMap[skuId];
      const stockMeta = q && typeof q === 'object' ? stockInfo(q, info) : (q != null ? { qty: number(q), available: number(q) == null ? null : number(q) > 0, status: number(q) == null ? 'unknown' : (number(q) > 0 ? 'in_stock' : 'out_of_stock') } : stockInfo(info));
      combinations.push({
        supplier_sku_id: skuId,
        sku_attr: rawAttrs,
        attributes,
        supplier_price: price == null ? null : { amount: price, currency, kind: 'network' },
        supplier_regular_price: null,
        stock: stockMeta.qty,
        stock_qty: stockMeta.qty,
        stock_status: stockMeta.status,
        available: stockMeta.available,
      });
    }
    diagnostics.sku_rows_found = Math.max(Number(diagnostics.sku_rows_found || 0), priceEntries.length);
    diagnostics.dimension_count = Math.max(Number(diagnostics.dimension_count || 0), dimensions.length);
    diagnostics.priced_rows = Math.max(Number(diagnostics.priced_rows || 0), combinations.filter((row) => row.supplier_price && number(row.supplier_price.amount) > 0).length);
    diagnostics.mapped_rows = Math.max(Number(diagnostics.mapped_rows || 0), combinations.length);
    addStockDiagnostics(diagnostics, combinations);
    diagnostics.modern_props_path = parts.propsPath;
    diagnostics.modern_price_path = parts.pricePath;
    diagnostics.modern_quantity_path = parts.quantityPath || '';
    return { source: source + ':' + parts.pricePath, dimensions, combinations, diagnostics, captured_at: new Date().toISOString() };
  }

  function inspectStructuredNetworkPayload(root, meta) {
    if (!root || typeof root !== 'object') return null;
    networkDiagnostics.network_json_inspected++;
    rememberNetworkUrl(meta && meta.url);
    const source = 'network:' + text(meta && meta.kind || 'response') + ':' + networkUrlLabel(meta && meta.url);

    const desc = findDescriptionInObject(root, 11, source, { urlHint: meta && meta.url });
    if (desc && (desc.html || desc.url)) {
      networkDiagnostics.network_description_candidates++;
      warmDescription = desc;
    }

    let found = findSkuContainerInObject(root, 12, source);
    let payload = null;
    if (found) {
      networkDiagnostics.network_sku_candidates++;
      const diagnostics = mergeNetworkDiagnostics({ network_source: source });
      payload = normalizeSkuData(found.module, found.path || source, diagnostics);
    } else {
      const diagnostics = mergeNetworkDiagnostics({ network_source: source });
      payload = normalizeModernSkuPayload(root, source, diagnostics);
      if (payload) networkDiagnostics.network_sku_candidates++;
    }

    if (matrixResolverContext && isPdpAdjustUrl(meta && meta.url) && !/\/embedded:/i.test(text(meta && meta.kind))) {
      networkDiagnostics.matrix_adjust_responses++;
      networkDiagnostics.matrix_adjust_last_url = networkUrlLabel(meta && meta.url);
      const adjustDiagnostics = mergeNetworkDiagnostics({ network_source: source, matrix_context_value: text(matrixResolverContext.missing && matrixResolverContext.missing.label) });
      const adjustPayload = normalizePdpAdjustPayload(root, source, adjustDiagnostics, matrixResolverContext);
      if (adjustPayload) {
        payload = payload ? mergeSkuPayload(payload, adjustPayload) : adjustPayload;
        networkPartialPayload = mergeSkuPayload(networkPartialPayload, adjustPayload);
        warmSkuPayload = mergeSkuPayload(warmSkuPayload, adjustPayload);
      }
    }

    const knownIds = new Set();
    for (const row of payload && Array.isArray(payload.combinations) ? payload.combinations : []) {
      const id = text(row && row.supplier_sku_id);
      if (id) knownIds.add(id);
    }
    for (const id of knownSkuIdSet()) knownIds.add(id);
    const stockOnly = normalizeStockOnlyPayload(root, source, mergeNetworkDiagnostics({ network_source: source }), knownIds);
    if (stockOnly) {
      payload = payload ? mergeSkuPayload(payload, stockOnly) : stockOnly;
      if (warmSkuPayload) warmSkuPayload = mergeSkuPayload(warmSkuPayload, stockOnly);
      if (networkPartialPayload) networkPartialPayload = mergeSkuPayload(networkPartialPayload, stockOnly);
    }

    const embedded = embeddedJsonObjects(root, 8);
    for (const item of embedded) {
      const nested = inspectStructuredNetworkPayload(item.value, { kind: (meta && meta.kind || 'response') + '/embedded:' + item.key, url: meta && meta.url });
      if (nested && nested.combinations && nested.combinations.length) payload = payload ? mergeSkuPayload(payload, nested) : nested;
    }

    if (payload) {
      payload.diagnostics = mergeNetworkDiagnostics(payload.diagnostics || {});
      if (warmDescription) payload.description = warmDescription;
      if (payload.dimensions && payload.dimensions.length) networkPartialPayload = mergeSkuPayload(networkPartialPayload, payload);
      const complete = payload.combinations && payload.combinations.length && payload.combinations.every((row) => row.supplier_sku_id && row.supplier_price && number(row.supplier_price.amount) > 0 && (!payload.dimensions.length || (row.attributes || []).length >= payload.dimensions.length));
      if (complete) warmSkuPayload = mergeSkuPayload(warmSkuPayload, payload);
      else if (warmSkuPayload) warmSkuPayload = mergeSkuPayload(warmSkuPayload, payload);
    }
    return payload;
  }

  function inspectNetworkText(bodyText, meta) {
    const body = bodyText == null ? '' : String(bodyText);
    if (!body || body.length > 5 * 1024 * 1024) return;
    networkDiagnostics.network_text_inspected++;
    rememberNetworkUrl(meta && meta.url);
    if (/(?:description|desc)(?:\.|\/|_|-)/i.test(String(meta && meta.url || '')) && looksLikeDescriptionHtml(body) && !descriptionRejectReason(body)) {
      networkDiagnostics.network_description_candidates++;
      warmDescription = { html: body.trim(), source: 'network-html:' + networkUrlLabel(meta && meta.url), url: null, visited: 0 };
    }
    const parsed = parseNetworkJson(body);
    if (parsed && typeof parsed === 'object') inspectStructuredNetworkPayload(parsed, meta);
  }

  function installNetworkObserver() {
    if (window.__CDH_NETWORK_OBSERVER__) return;
    window.__CDH_NETWORK_OBSERVER__ = true;
    networkDiagnostics.network_observer_installed = true;

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function () {
        const args = arguments;
        let url = '';
        try { url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''; } catch (e) {}
        const result = originalFetch.apply(this, args);
        if (!isAliNetworkUrl(url)) return result;
        networkDiagnostics.network_requests_observed++;
        return result.then((response) => {
          try {
            networkDiagnostics.network_fetch_responses++;
            const clone = response && typeof response.clone === 'function' ? response.clone() : null;
            if (clone) {
              const len = number(clone.headers && clone.headers.get && clone.headers.get('content-length'));
              if (len == null || len <= 5 * 1024 * 1024) clone.text().then((body) => inspectNetworkText(body, { kind: 'fetch', url })).catch(() => {});
            }
          } catch (e) {}
          return response;
        });
      };
    }

    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        try { this.__cdhNetworkUrl = String(url || ''); } catch (e) {}
        return originalOpen.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        const xhr = this;
        const url = xhr.__cdhNetworkUrl || '';
        if (isAliNetworkUrl(url) && !xhr.__cdhNetworkObserved) {
          xhr.__cdhNetworkObserved = true;
          networkDiagnostics.network_requests_observed++;
          try { xhr.addEventListener('loadend', function () {
            networkDiagnostics.network_xhr_responses++;
            try {
              if (xhr.responseType === 'json' && xhr.response && typeof xhr.response === 'object') inspectStructuredNetworkPayload(xhr.response, { kind: 'xhr-json', url });
              else if (!xhr.responseType || xhr.responseType === 'text') inspectNetworkText(xhr.responseText, { kind: 'xhr', url });
            } catch (e) {}
          }, { once: true }); } catch (e) {}
        }
        return originalSend.apply(this, arguments);
      };
    }

    function wrapJsonpCallback(name, url) {
      if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return;
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        let fn;
        try { fn = window[name]; } catch (e) {}
        if (typeof fn === 'function' && !fn.__cdhWrapped) {
          const wrapped = function (payload) {
            try {
              networkDiagnostics.network_jsonp_payloads++;
              inspectStructuredNetworkPayload(payload, { kind: 'jsonp', url });
            } catch (e) {}
            return fn.apply(this, arguments);
          };
          wrapped.__cdhWrapped = true;
          try { window[name] = wrapped; } catch (e) {}
          clearInterval(timer);
        } else if (attempts >= 80) clearInterval(timer);
      }, 10);
    }

    function inspectScriptNode(node) {
      if (!node || String(node.tagName || '').toUpperCase() !== 'SCRIPT') return;
      const src = text(node.src || (node.getAttribute && node.getAttribute('src')));
      if (!src || !isAliNetworkUrl(src)) return;
      let parsed;
      try { parsed = new URL(src, location.href); } catch (e) { return; }
      const callback = parsed.searchParams.get('callback');
      if (!callback && !/mtop\.aliexpress\.pdp\.pc\.query/i.test(src)) return;
      networkDiagnostics.network_requests_observed++;
      networkDiagnostics.network_jsonp_scripts++;
      rememberNetworkUrl(src);
      if (callback) wrapJsonpCallback(callback, src);
    }

    if (typeof Node !== 'undefined' && Node.prototype) {
      const originalAppend = Node.prototype.appendChild;
      const originalInsert = Node.prototype.insertBefore;
      Node.prototype.appendChild = function (node) { try { inspectScriptNode(node); } catch (e) {} return originalAppend.apply(this, arguments); };
      Node.prototype.insertBefore = function (node) { try { inspectScriptNode(node); } catch (e) {} return originalInsert.apply(this, arguments); };
    }
  }

  async function captureSkuData(options) {
    const opts = options || {};
    const warmAtStart = warmSkuPayload && Array.isArray(warmSkuPayload.combinations) && warmSkuPayload.combinations.length ? warmSkuPayload : null;
    if (!opts.force && warmAtStart) {
      const coverage = stockCoverage(warmAtStart);
      // A fully enriched cache is returned immediately. If stock is still unknown, keep a
      // short best-effort window open so late AliExpress quantity payloads can enrich it.
      const matrix = matrixCoverage(warmAtStart);
      if (matrix.complete && coverage.rows && coverage.status >= coverage.rows) {
        const copy = Object.assign({}, warmAtStart);
        copy.diagnostics = mergeNetworkDiagnostics(Object.assign({}, copy.diagnostics || {}, { warm_cache_hit: true, stock_cache_complete: true }));
        if (warmDescription) copy.description = warmDescription;
        return copy;
      }
    }

    const diagnostics = mergeNetworkDiagnostics({
      runtime_roots_checked: 0,
      scripts_scanned: 0,
      scripts_matched: 0,
      data_sku_nodes: document.querySelectorAll('[data-sku-col]').length,
      started_at: new Date().toISOString(),
      warm_capture_started: !!opts.warm,
    });
    const deadline = Date.now() + (opts.warm ? 12000 : (warmAtStart ? 1800 : 6500));
    let scriptScanAt = 0;
    do {
      if (warmSkuPayload && Array.isArray(warmSkuPayload.combinations) && warmSkuPayload.combinations.length) {
        const coverage = stockCoverage(warmSkuPayload);
        const matrix = matrixCoverage(warmSkuPayload);
        if (opts.warm || (matrix.complete && coverage.rows && coverage.status >= coverage.rows)) {
          const live = Object.assign({}, warmSkuPayload);
          live.diagnostics = mergeNetworkDiagnostics(Object.assign({}, live.diagnostics || {}, { warm_cache_hit: true, network_live_hit: true, stock_cache_complete: coverage.rows > 0 && coverage.status >= coverage.rows }));
          if (warmDescription) live.description = warmDescription;
          return live;
        }
      }
      let found = locateSkuModuleInRuntime(diagnostics);
      if (!warmDescription) {
        const desc = locateRuntimeDescription();
        if (desc) warmDescription = desc;
      }
      if (!found && Date.now() >= scriptScanAt) {
        found = findSkuContainerInScripts(diagnostics);
        scriptScanAt = Date.now() + 1000;
      }
      if (found) {
        const payload = normalizeSkuData(found.module, found.source, mergeNetworkDiagnostics(diagnostics));
        payload.diagnostics = mergeNetworkDiagnostics(payload.diagnostics || diagnostics);
        if (warmDescription) payload.description = warmDescription;
        if (payload.combinations.length && payload.dimensions.length) warmSkuPayload = mergeSkuPayload(warmSkuPayload, payload);
        const coverage = stockCoverage(warmSkuPayload || payload);
        const matrix = matrixCoverage(warmSkuPayload || payload);
        if (opts.warm || (matrix.complete && coverage.rows && coverage.status >= coverage.rows)) return warmSkuPayload || payload;
        // Prices/mappings are already safe; keep waiting briefly for a stock/availability map.
      }
      await new Promise((resolve) => setTimeout(resolve, opts.warm ? 180 : 250));
    } while (Date.now() < deadline);
    diagnostics.timeout = true;
    diagnostics.finished_at = new Date().toISOString();
    mergeNetworkDiagnostics(diagnostics);
    const fallback = warmSkuPayload && Array.isArray(warmSkuPayload.combinations) && warmSkuPayload.combinations.length ? warmSkuPayload : null;
    const partial = networkPartialPayload && Array.isArray(networkPartialPayload.dimensions) && networkPartialPayload.dimensions.length ? networkPartialPayload : null;
    const sourcePayload = fallback || partial;
    const payload = sourcePayload ? Object.assign({}, sourcePayload, { combinations: Array.isArray(sourcePayload.combinations) ? sourcePayload.combinations : [], diagnostics: addStockDiagnostics(mergeNetworkDiagnostics(Object.assign({}, sourcePayload.diagnostics || {}, diagnostics)), sourcePayload.combinations || []), captured_at: sourcePayload.captured_at || new Date().toISOString() }) : { source: null, dimensions: [], combinations: [], diagnostics: addStockDiagnostics(diagnostics, []), captured_at: new Date().toISOString() };
    addMatrixDiagnostics(payload.diagnostics || (payload.diagnostics = {}), payload);
    if (warmDescription) payload.description = warmDescription;
    return payload;
  }

  function startWarmCapture() {
    if (warmSkuPromise) return warmSkuPromise;
    warmSkuPromise = captureSkuData({ warm: true }).catch(() => null);
    return warmSkuPromise;
  }

  // Start immediately at document_start. Observe AliExpress's own network before hydration
  // and keep warm runtime/script fallbacks in parallel. This warm phase is read-only; the
  // bounded variant-selection stock resolver runs only on an explicit editor extraction request.
  installNetworkObserver();
  startWarmCapture();


  if (window.__CDH_TEST_MODE__ === true) {
    window.__CDH_PAGE_BRIDGE_TEST__ = {
      parseSkuAttr,
      normalizeSkuData,
      findSkuContainerInObject,
      findDescriptionInObject,
      looksLikeDescriptionHtml,
      decodeDescriptionHtml,
      descriptionCandidateScore,
      descriptionRejectReason,
      normalizeModernSkuPayload,
      inspectStructuredNetworkPayload,
      parseNetworkJson,
      parseLocalizedAmount,
      stockInfo,
      stockCoverage,
      mergeSkuPayload,
      collectStockOnlyRows,
      normalizeStockOnlyPayload,
      collectPdpAdjustSkuCandidates,
      normalizePdpAdjustPayload,
      resolveMissingSkuStock,
      visibleDimensionValues,
      matrixCoverage,
      addMatrixDiagnostics,
      resolveIncompleteSkuMatrix,
    };
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'cdh-isolated') return;
    if (event.data.type !== 'CDH_REQUEST_SKU_DATA') return;
    const requestId = text(event.data.requestId);
    try {
      if (warmSkuPromise) {
        try { await Promise.race([warmSkuPromise, new Promise((resolve) => setTimeout(resolve, 1200))]); } catch (e) {}
      }
      let payload = await captureSkuData();
      if (event.data.resolveMatrix === true) {
        try {
          payload = await resolveIncompleteSkuMatrix(payload, {
            maxMatrixResolveValues: Number(event.data.maxMatrixResolveValues || 24),
            matrixResolveBudgetMs: Number(event.data.matrixResolveBudgetMs || 6500),
            matrixResolvePerValueMs: Number(event.data.matrixResolvePerValueMs || 700),
          });
        } catch (matrixError) {
          networkDiagnostics.matrix_resolver_last_error = text(matrixError && matrixError.message);
          payload = Object.assign({}, payload, { diagnostics: addMatrixDiagnostics(mergeNetworkDiagnostics(Object.assign({}, payload && payload.diagnostics || {}, { matrix_resolver_error: networkDiagnostics.matrix_resolver_last_error || 'unknown' })), payload || {}) });
        }
      }
      if (event.data.resolveStock === true) {
        try {
          payload = await resolveMissingSkuStock(payload, {
            maxStockResolveSkus: Number(event.data.maxStockResolveSkus || 24),
            stockResolveBudgetMs: Number(event.data.stockResolveBudgetMs || 5200),
            stockResolvePerSkuMs: Number(event.data.stockResolvePerSkuMs || 420),
          });
        } catch (resolverError) {
          networkDiagnostics.stock_resolver_last_error = text(resolverError && resolverError.message);
          payload = Object.assign({}, payload, {
            diagnostics: mergeNetworkDiagnostics(Object.assign({}, payload && payload.diagnostics || {}, {
              stock_resolver_error: networkDiagnostics.stock_resolver_last_error || 'unknown',
            })),
          });
        }
      }
      const waitForDescriptionMs = Math.max(0, Math.min(2500, Number(event.data.waitForDescriptionMs || 0)));
      if (waitForDescriptionMs && !warmDescription) {
        const until = Date.now() + waitForDescriptionMs;
        while (!warmDescription && Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (warmDescription) payload = Object.assign({}, payload, { description: warmDescription });
      }
      window.postMessage({ source: 'cdh-page-bridge', type: 'CDH_SKU_DATA', requestId, payload }, '*');
    } catch (error) {
      window.postMessage({ source: 'cdh-page-bridge', type: 'CDH_SKU_DATA', requestId, payload: { source: null, dimensions: [], combinations: [], diagnostics: { error: text(error && error.message) } } }, '*');
    }
  });
})();
