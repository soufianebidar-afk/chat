/**
 * Constello Dropship Hub — editor.js
 * Professional product-preparation workspace for AliExpress imports.
 */
( function ( root ) {
	'use strict';

	function slugify( text ) {
		return String( text || '' ).trim().toLowerCase().normalize( 'NFD' )
			.replace( /[\u0300-\u036f]/g, '' ).replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ) || 'x';
	}

	function normalizeEditorMediaUrl( raw ) {
		const value = String( raw || '' ).trim();
		if ( ! value ) return '';
		if ( /^data:image\//i.test( value ) ) return value;
		try {
			const url = new URL( value );
			return url.protocol === 'https:' ? url.href : '';
		} catch ( e ) { return ''; }
	}

	function isForbiddenMediaUrl( raw ) {
		return /^(?:file:|blob:|chrome-extension:|moz-extension:)/i.test( String( raw || '' ).trim() );
	}

	function normalizeImagesWithMedia( images, mediaIds ) {
		const out = [];
		const ids = [];
		const seen = new Set();
		( images || [] ).forEach( ( raw, index ) => {
			const url = normalizeEditorMediaUrl( raw );
			if ( ! url || seen.has( url ) ) return;
			seen.add( url );
			out.push( url );
			ids.push( Number( mediaIds && mediaIds[ index ] ) || null );
		} );
		return { images: out, mediaIds: ids };
	}

	function dedupeImages( urls ) { return normalizeImagesWithMedia( urls, [] ).images; }

	function isSizeAttribute( raw ) {
		return [ 'taille', 'size', 'talla', 'groesse', 'grosse' ].includes( slugify( raw ) );
	}

	function normalizeSupplierOptionValue( rawValue, rawAttribute ) {
		const value = String( rawValue || '' ).trim();
		if ( ! value || ! isSizeAttribute( rawAttribute ) ) return value;
		const match = value.match( /^((?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-9]XL))['’]$/i );
		return match ? String( match[1] ).toUpperCase() : value;
	}

	function groupVariants( rawVariants ) {
		const groups = [];
		const byKey = new Map();
		for ( const v of rawVariants || [] ) {
			const key = ( ( v && v.supplier_variation_key ) || '' ).split( ':' )[ 0 ] || '';
			const sourcePropertyId = String( v && v.source_property_id || '' );
			const mapKey = sourcePropertyId ? `id:${ sourcePropertyId }` : `slug:${ key }`;
			let group = byKey.get( mapKey );
			if ( ! group ) {
				const sourceAttribute = ( v && v.dimension_label ? String( v.dimension_label ).trim() : '' );
				group = {
					attribute: sourceAttribute,
					sourceAttribute,
					sourcePropertyId,
					wooTargetType: 'product',
					wooAttributeId: 0,
					wooTaxonomy: '',
					wooAttributeName: sourceAttribute,
					options: [],
				};
				byKey.set( mapKey, group );
				groups.push( group );
			}
			const sourceValue = v && v.label_raw ? String( v.label_raw ).trim() : '';
			const imageUrl = ( v && v.image_url ) || null;
			group.options.push( {
				value: sourceValue, wooValue: normalizeSupplierOptionValue( sourceValue, group.sourceAttribute ),
				imageUrl, originalImageUrl: imageUrl, imageModified: false,
				sourceValueId: String( v && v.source_value_id || '' ),
			} );
		}
		return groups;
	}


	function sourceMappingKey( text ) { return slugify( text ); }
	function catalogAttributes() { return shopConfig && Array.isArray( shopConfig.attribute_catalog ) ? shopConfig.attribute_catalog : []; }
	function savedAttributeMappings() { return shopConfig && Array.isArray( shopConfig.attribute_mappings ) ? shopConfig.attribute_mappings : []; }
	function mappingForSource( source ) { const key = sourceMappingKey( source ); return savedAttributeMappings().find( ( item ) => sourceMappingKey( item && item.source_label ) === key ) || null; }
	function catalogAttributeById( id ) { return catalogAttributes().find( ( item ) => Number( item && item.id ) === Number( id ) ) || null; }
	function applyCatalogMappings( groups ) {
		( groups || [] ).forEach( ( group ) => {
			const source = String( group.sourceAttribute || group.attribute || '' ).trim();
			const mapping = mappingForSource( source );
			if ( mapping ) {
				group.wooTargetType = mapping.target_type || 'product';
				group.wooAttributeId = Number( mapping.attribute_id || 0 );
				group.wooTaxonomy = String( mapping.taxonomy || '' );
				group.wooAttributeName = String( mapping.target_name || source );
				const valueMap = mapping.value_map || {};
				( group.options || [] ).forEach( ( opt ) => {
					const found = valueMap[ sourceMappingKey( opt.value ) ] || Object.values( valueMap ).find( ( item ) => sourceMappingKey( item && item.source ) === sourceMappingKey( opt.value ) );
					if ( found && found.target ) opt.wooValue = String( found.target );
				} );
			} else {
				const exact = catalogAttributes().find( ( item ) => sourceMappingKey( item && item.name ) === sourceMappingKey( source ) );
				if ( exact ) {
					group.wooTargetType = 'global'; group.wooAttributeId = Number( exact.id || 0 ); group.wooTaxonomy = String( exact.taxonomy || '' ); group.wooAttributeName = String( exact.name || source );
				}
			}
		} );
		return groups;
	}
	function targetAttributeName( group ) { return String( group && group.wooAttributeName || group && group.attribute || group && group.sourceAttribute || '' ).trim(); }
	function targetPricingName( group ) { if ( group && group.wooTargetType === 'global' && group.wooTaxonomy ) return String( group.wooTaxonomy ); if ( group && group.wooTargetType === 'create_global' ) return `pa_${ slugify( targetAttributeName( group ) ).slice( 0, 28 ) }`; return targetAttributeName( group ); }
	function targetOptionValue( opt ) { return String( opt && opt.wooValue != null ? opt.wooValue : opt && opt.value || '' ).trim(); }
	const mappingSaveTimers = new Map();
	const openVariantGroupKeys = new Set();
	let variantUiInitialized = false;

	function variantGroupUiKey( group, index ) {
		if ( group && group._uiKey ) return String( group._uiKey );
		const sourceId = String( group && group.sourcePropertyId || '' ).trim();
		const sourceName = String( group && ( group.sourceAttribute || group.attribute ) || '' ).trim();
		const key = sourceId ? `source:${ sourceId }` : sourceName ? `name:${ slugify( sourceName ) }` : `new:${ Date.now() }:${ index }`;
		if ( group ) group._uiKey = key;
		return key;
	}

	function snapshotVariantAccordionState() {
		if ( ! els || ! els.variantGroups ) return false;
		const groups = els.variantGroups.querySelectorAll( 'details.variant-group[data-group-key]' );
		if ( ! groups.length ) return false;
		groups.forEach( ( item ) => {
			const key = item.dataset.groupKey || '';
			if ( ! key ) return;
			if ( item.open ) openVariantGroupKeys.add( key );
			else openVariantGroupKeys.delete( key );
		} );
		return true;
	}

	function captureVariantInteractionState() {
		if ( ! els || ! els.variantGroups ) return null;
		const active = document.activeElement;
		const details = active && active.closest ? active.closest( 'details.variant-group[data-group-key]' ) : null;
		if ( ! details || ! els.variantGroups.contains( details ) ) return null;
		return {
			groupKey: details.dataset.groupKey || '',
			focusRole: active.dataset && active.dataset.focusRole || '',
			optionIndex: active.dataset && active.dataset.optionIndex || '',
			scrollX: typeof window !== 'undefined' ? window.scrollX : 0,
			scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
		};
	}

	function restoreVariantInteractionState( uiState ) {
		if ( ! uiState || ! els || ! els.variantGroups ) return;
		const escapedKey = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape( uiState.groupKey ) : String( uiState.groupKey ).replace( /[\"\\]/g, '\\$&' );
		const details = els.variantGroups.querySelector( `details.variant-group[data-group-key="${ escapedKey }"]` );
		if ( details ) details.open = true;
		let target = null;
		if ( details && uiState.focusRole ) {
			const role = String( uiState.focusRole ).replace( /[\"\\]/g, '\\$&' );
			const option = String( uiState.optionIndex || '' ).replace( /[\"\\]/g, '\\$&' );
			const selector = option !== '' ? `[data-focus-role="${ role }"][data-option-index="${ option }"]` : `[data-focus-role="${ role }"]`;
			target = details.querySelector( selector );
		}
		const restore = () => {
			if ( typeof window !== 'undefined' && typeof window.scrollTo === 'function' ) {
				try { window.scrollTo( uiState.scrollX || 0, uiState.scrollY || 0 ); } catch ( e ) {}
			}
			if ( target && typeof target.focus === 'function' ) { try { target.focus( { preventScroll: true } ); } catch ( e ) { try { target.focus(); } catch ( err ) {} } }
		};
		if ( typeof requestAnimationFrame === 'function' ) requestAnimationFrame( restore ); else setTimeout( restore, 0 );
	}
	function persistGroupMapping( group ) {
		if ( ! group ) return;
		const sourceLabel = String( group.sourceAttribute || group.attribute || '' ).trim();
		const targetName = targetAttributeName( group );
		if ( ! sourceLabel || ! targetName || typeof chrome === 'undefined' || ! chrome.runtime ) return;
		const key = sourceMappingKey( sourceLabel );
		if ( mappingSaveTimers.has( key ) ) clearTimeout( mappingSaveTimers.get( key ) );
		mappingSaveTimers.set( key, setTimeout( async () => {
			mappingSaveTimers.delete( key );
			try {
				await chrome.runtime.sendMessage( { type: 'CDH_SAVE_ATTRIBUTE_MAPPING', payload: {
					source_label: sourceLabel, target_type: group.wooTargetType || 'product', attribute_id: Number( group.wooAttributeId || 0 ), taxonomy: String( group.wooTaxonomy || '' ), target_name: targetName,
					value_map: ( group.options || [] ).filter( ( opt ) => String( opt.value || '' ).trim() && targetOptionValue( opt ) ).map( ( opt ) => ( { source: String( opt.value ).trim(), target: targetOptionValue( opt ) } ) ),
				} } );
			} catch ( e ) {}
		}, 420 ) );
	}


	function normalizeCharacteristics( rawAttributes ) {
		return ( rawAttributes || [] ).filter( ( item ) => item && ( item.name || item.source_label ) ).map( ( item, index ) => ( {
			id: `attr-${ index }-${ Date.now() }`,
			selected: item.selected !== false,
			name: String( item.name || item.source_label || '' ).trim(),
			value: String( item.value || item.source_value || '' ).trim(),
			source_label: String( item.source_label || item.name || '' ).trim(),
			source_value: String( item.source_value || item.value || '' ).trim(),
		} ) );
	}


	function pricingNumber( value, fallback ) {
		const n = parseFloat( value );
		return Number.isFinite( n ) ? n : ( fallback == null ? 0 : fallback );
	}

	function validPricingGroups( groups ) {
		return ( groups || [] ).map( ( group ) => {
			const attribute = targetPricingName( group );
			const seen = new Set();
			const options = [];
			for ( const opt of ( group && group.options ) || [] ) {
				if ( opt && opt.importEnabled === false ) continue;
				const value = targetOptionValue( opt );
				if ( ! value ) continue;
				const key = value.toLowerCase();
				if ( seen.has( key ) ) continue;
				seen.add( key );
				options.push( { value, source: opt } );
			}
			return { attribute, options };
		} ).filter( ( group ) => group.attribute && group.options.length );
	}

	function pricingCombinationKey( attributes ) {
		return ( attributes || [] ).map( ( item ) => `${ slugify( item.name ) }=${ slugify( item.value ) }` ).join( '|' );
	}


	function supplierPricingCombinations( state ) {
		const groups = validPricingGroups( state.variantGroups );
		const raw = Array.isArray( state.supplierVariations ) ? state.supplierVariations : [];
		if ( ! raw.length || ! groups.length ) return { combinations: [], ambiguous: false };
		const groupBySource = new Map();
		( state.variantGroups || [] ).forEach( ( group ) => {
			if ( group && group.sourcePropertyId ) groupBySource.set( String( group.sourcePropertyId ), group );
		} );
		const byKey = new Map();
		let ambiguous = false;
		for ( const sku of raw ) {
			const mapped = [];
			for ( const sourceAttr of Array.isArray( sku && sku.attributes ) ? sku.attributes : [] ) {
				let group = sourceAttr.property_id ? groupBySource.get( String( sourceAttr.property_id ) ) : null;
				if ( ! group && sourceAttr.name ) group = ( state.variantGroups || [] ).find( ( item ) => slugify( item.sourceAttribute || item.attribute ) === slugify( sourceAttr.name ) );
				if ( ! group ) continue; // dimension supprimée volontairement par l'utilisateur.
				let option = sourceAttr.value_id ? ( group.options || [] ).find( ( item ) => String( item.sourceValueId || '' ) === String( sourceAttr.value_id ) ) : null;
				if ( ! option && sourceAttr.value ) option = ( group.options || [] ).find( ( item ) => slugify( item.value ) === slugify( sourceAttr.value ) );
				if ( ! option || option.importEnabled === false || ! targetPricingName( group ) || ! targetOptionValue( option ) ) { mapped.length = 0; break; }
				mapped.push( { name: targetPricingName( group ), value: targetOptionValue( option ) } );
			}
			if ( mapped.length !== groups.length ) continue;
			const key = pricingCombinationKey( mapped );
			const price = sku && sku.supplier_price && pricingNumber( sku.supplier_price.amount, 0 ) > 0 ? pricingNumber( sku.supplier_price.amount, 0 ) : 0;
			const currency = String( sku && sku.supplier_price && sku.supplier_price.currency || state.priceCurrency || '' ).toUpperCase();
			const item = {
				key,
				attributes: mapped,
				supplier_sku_id: String( sku && sku.supplier_sku_id || '' ),
				sku_attr: String( sku && sku.sku_attr || '' ),
				supplier_price: price,
				supplier_currency: currency,
				supplier_regular_price: sku && sku.supplier_regular_price ? pricingNumber( sku.supplier_regular_price.amount, 0 ) : price,
				supplier_stock: sku && sku.stock_qty != null ? pricingNumber( sku.stock_qty, null ) : ( sku && sku.stock != null ? pricingNumber( sku.stock, null ) : null ),
				supplier_stock_status: String( sku && sku.stock_status || '' ).trim() || ( sku && sku.available === true ? 'in_stock' : sku && sku.available === false ? 'out_of_stock' : 'unknown' ),
				supplier_available: sku && sku.available != null ? !! sku.available : null,
				supplier_observed_at: String( sku && sku.observed_at || state.supplierSkuCapturedAt || '' ),
			};
			if ( byKey.has( key ) ) {
				ambiguous = true;
				const previous = byKey.get( key );
				previous.ambiguous = true;
				item.ambiguous = true;
				// Keep the cheapest observed cost only for display; validation will block automatic pricing.
				if ( item.supplier_price > 0 && ( ! previous.supplier_price || item.supplier_price < previous.supplier_price ) ) byKey.set( key, item );
			} else byKey.set( key, item );
		}
		return { combinations: Array.from( byKey.values() ), ambiguous };
	}

	function mappedSupplierVariations( state ) {
		const raw = Array.isArray( state && state.supplierVariations ) ? state.supplierVariations : [];
		const sourceDimensions = Array.isArray( state && state.supplierVariantDimensions ) ? state.supplierVariantDimensions : [];
		// A genuinely simple AliExpress product may still expose one supplier SKU. Keep it for
		// price/stock monitoring even though WooCommerce does not need a variation matrix.
		if ( ! sourceDimensions.length && ! validPricingGroups( state && state.variantGroups || [] ).length && raw.length ) {
			return { ambiguous: false, variations: raw.map( ( sku ) => {
				const stockQty = sku && sku.stock_qty != null ? pricingNumber( sku.stock_qty, null ) : ( sku && sku.stock != null ? pricingNumber( sku.stock, null ) : null );
				return {
					supplier_sku_id: String( sku && sku.supplier_sku_id || '' ), sku_attr: String( sku && sku.sku_attr || '' ),
					attributes: Array.isArray( sku && sku.attributes ) ? sku.attributes.map( ( item ) => ( { property_id: item.property_id || '', value_id: item.value_id || '', name: item.name || '', value: item.value || '' } ) ) : [],
					supplier_price: sku && sku.supplier_price ? sku.supplier_price : { amount: 0, currency: state.priceCurrency || '' },
					supplier_regular_price: sku && sku.supplier_regular_price ? sku.supplier_regular_price : ( sku && sku.supplier_price ? sku.supplier_price : { amount: 0, currency: state.priceCurrency || '' } ),
					stock: stockQty, stock_qty: stockQty,
					stock_status: String( sku && sku.stock_status || '' ).trim() || ( sku && sku.available === true ? 'in_stock' : sku && sku.available === false ? 'out_of_stock' : 'unknown' ),
					available: sku && sku.available != null ? !! sku.available : null,
					observed_at: String( sku && sku.observed_at || state.supplierSkuCapturedAt || '' ),
				};
			} ) };
		}
		const real = supplierPricingCombinations( state );
		return {
			ambiguous: !! real.ambiguous,
			variations: ( real.combinations || [] ).map( ( combo ) => ( {
				supplier_sku_id: combo.supplier_sku_id || '',
				sku_attr: combo.sku_attr || '',
				attributes: ( combo.attributes || [] ).map( ( item ) => ( { name: item.name, value: item.value } ) ),
				supplier_price: { amount: combo.supplier_price || 0, currency: combo.supplier_currency || state.priceCurrency || '' },
				supplier_regular_price: { amount: combo.supplier_regular_price || combo.supplier_price || 0, currency: combo.supplier_currency || state.priceCurrency || '' },
				stock: combo.supplier_stock == null ? null : combo.supplier_stock,
				stock_qty: combo.supplier_stock == null ? null : combo.supplier_stock,
				stock_status: combo.supplier_stock_status || 'unknown',
				available: combo.supplier_available == null ? null : combo.supplier_available,
				observed_at: combo.supplier_observed_at || state.supplierSkuCapturedAt || '',
			} ) ),
		};
	}


	function supplierMatrixCoverage( payload ) {
		const variants = Array.isArray( payload && payload.variants ) ? payload.variants : [];
		const rows = Array.isArray( payload && payload.supplier_variations ) ? payload.supplier_variations : [];
		const diagnostics = payload && payload.supplier_sku_diagnostics && typeof payload.supplier_sku_diagnostics === 'object' ? payload.supplier_sku_diagnostics : {};
		const options = [];
		const dimensions = new Set();
		for ( const variant of variants ) {
			const name = String( variant && variant.dimension_label || '' ).trim();
			const value = String( variant && variant.label_raw || '' ).trim();
			if ( ! name || ! value ) continue;
			dimensions.add( slugify( name ) );
			const key = `${ slugify( name ) }=${ slugify( value ) }`;
			if ( ! options.some( ( item ) => item.key === key ) ) options.push( { key, name, value } );
		}
		const unused = options.filter( ( option ) => ! rows.some( ( row ) => ( Array.isArray( row && row.attributes ) ? row.attributes : [] ).some( ( attr ) => slugify( attr && attr.name || '' ) === slugify( option.name ) && slugify( attr && attr.value || '' ) === slugify( option.value ) ) ) );
		const verifiedRows = rows.filter( ( row ) => row && row.supplier_sku_id && row.supplier_price && Number( row.supplier_price.amount ) > 0 ).length;
		const exact = dimensions.size === 1;
		const expected = exact ? options.length : null;
		if ( exact ) {
			return {
				complete: unused.length === 0 && verifiedRows >= expected,
				exact, expectedSkus: expected, verifiedSkus: verifiedRows, mappedSkus: verifiedRows,
				optionCount: options.length, missing: unused, unused, unresolvedSkus: 0,
			};
		}

		// On a multi-dimensional AliExpress product, an option displayed in the UI does not imply
		// a real cartesian SKU. Completeness is based on real supplier SKU paths, not on every value
		// appearing at least once. The bridge diagnostics tell us if a priced real SKU could not be
		// mapped to a full property path; a row dropped during WooCommerce mapping is also unresolved.
		const diagnosticVerified = Number.isFinite( Number( diagnostics.matrix_verified_skus ) ) ? Number( diagnostics.matrix_verified_skus ) : verifiedRows;
		const diagnosticUnmapped = Number.isFinite( Number( diagnostics.matrix_unmapped_sku_count ) ) ? Number( diagnostics.matrix_unmapped_sku_count ) : 0;
		const totalRealSkus = Math.max( verifiedRows, diagnosticVerified );
		const droppedDuringMapping = Math.max( 0, totalRealSkus - verifiedRows );
		const unresolvedSkus = Math.max( diagnosticUnmapped, droppedDuringMapping );
		return {
			complete: verifiedRows > 0 && unresolvedSkus === 0,
			exact: false, expectedSkus: totalRealSkus || null, verifiedSkus: totalRealSkus,
			mappedSkus: verifiedRows, optionCount: options.length, missing: [], unused, unresolvedSkus,
		};
	}

	function stateMatrixCoverage( state, mapped ) {
		const groups = validPricingGroups( state && state.variantGroups || [] );
		const rows = mapped && Array.isArray( mapped.variations ) ? mapped.variations : [];
		const variants = groups.flatMap( ( group ) => group.options.map( ( option ) => ( { dimension_label: group.attribute, label_raw: option.value } ) ) );
		return supplierMatrixCoverage( { variants, supplier_variations: rows, supplier_sku_diagnostics: state && state.supplierSkuDiagnostics || {} } );
	}


	function sizeGuidePayload( state ) {
		const source = state && state.sizeGuide;
		if ( ! source || state.sizeGuideInclude === false ) return null;
		let guide;
		try { guide = JSON.parse( JSON.stringify( source ) ); } catch ( e ) { guide = source; }
		const groups = Array.isArray( state.variantGroups ) ? state.variantGroups : [];
		const group = groups.find( ( item ) => {
			const guideId = String( guide.source_property_id || '' ); const itemId = String( item && item.sourcePropertyId || '' );
			if ( guideId && itemId ) return guideId === itemId;
			return slugify( guide.source_attribute || '' ) === slugify( item && ( item.sourceAttribute || item.attribute ) || '' );
		} );
		guide.target_attribute = group ? targetAttributeName( group ) : String( guide.target_attribute || guide.source_attribute || 'Taille' );
		for ( const size of Array.isArray( guide.sizes ) ? guide.sizes : [] ) {
			const option = group ? ( group.options || [] ).find( ( item ) => {
				if ( size.source_value_id && item.sourceValueId ) return String( item.sourceValueId ) === String( size.source_value_id );
				return slugify( item.value || '' ) === slugify( size.source_value || '' );
			} ) : null;
			size.target_value = option ? targetOptionValue( option ) : String( size.target_value || size.source_value || '' );
		}
		return guide;
	}

	function supplierShippingSummary( shipping, basePrice, supplierVariations ) {
		const raw = shipping && typeof shipping === 'object' ? shipping : null;
		if ( ! raw ) return { detected: false, feeKnown: false, fee: null, currency: '', isFree: false, minDays: null, maxDays: null, landedCost: null, referencePrice: null, supplierSkuId: '' };
		const hasFeeValue = raw.fee !== null && raw.fee !== undefined && String( raw.fee ).trim() !== '' && Number.isFinite( Number( raw.fee ) );
		const feeKnown = raw.fee_known === true || hasFeeValue;
		const fee = feeKnown && hasFeeValue ? Number( raw.fee ) : ( raw.fee_known === true && raw.is_free_shipping ? 0 : null );
		let referencePrice = Number( raw.reference_supplier_price );
		if ( ! Number.isFinite( referencePrice ) || referencePrice <= 0 ) {
			const skuId = String( raw.supplier_sku_id || '' );
			const row = skuId ? ( Array.isArray( supplierVariations ) ? supplierVariations : [] ).find( ( item ) => String( item && item.supplier_sku_id || '' ) === skuId ) : null;
			referencePrice = row && row.supplier_price ? Number( row.supplier_price.amount ) : Number( basePrice );
		}
		if ( ! Number.isFinite( referencePrice ) || referencePrice <= 0 ) referencePrice = null;
		const minDays = Number.isFinite( Number( raw.delivery_min_days ) ) ? Number( raw.delivery_min_days ) : null;
		const maxDays = Number.isFinite( Number( raw.delivery_max_days ) ) ? Number( raw.delivery_max_days ) : null;
		return {
			detected: feeKnown || minDays != null || maxDays != null,
			feeKnown,
			fee,
			currency: String( raw.currency || '' ).toUpperCase(),
			isFree: feeKnown && fee === 0,
			minDays,
			maxDays,
			landedCost: feeKnown && referencePrice != null ? referencePrice + fee : null,
			referencePrice,
			supplierSkuId: String( raw.supplier_sku_id || '' ),
			method: String( raw.method || '' ),
		};
	}

	function shippingUiLabel( shipping, basePrice, supplierVariations ) {
		const summary = supplierShippingSummary( shipping, basePrice, supplierVariations );
		if ( ! summary.detected ) return 'Non détectée';
		const fee = summary.feeKnown ? ( summary.isFree ? 'Gratuite' : `${ summary.currency || '' } ${ Number( summary.fee ).toLocaleString( 'fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) }`.trim() ) : 'Frais inconnus';
		const delay = summary.minDays != null && summary.maxDays != null ? ` · ${ summary.minDays }–${ summary.maxDays } j` : '';
		return fee + delay;
	}

	function formatSupplierObservation( value ) {
		if ( ! value ) return '—';
		const date = new Date( value );
		if ( Number.isNaN( date.getTime() ) ) return String( value );
		const now = new Date();
		const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
		const time = date.toLocaleTimeString( 'fr-CH', { hour: '2-digit', minute: '2-digit' } );
		return sameDay ? `Aujourd’hui · ${ time }` : date.toLocaleString( 'fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' } );
	}

	function supplierVerificationLabel( value ) {
		if ( ! value ) return '';
		const date = new Date( value );
		if ( Number.isNaN( date.getTime() ) ) return `Vérifié le ${ String( value ) }`;
		const now = new Date();
		const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
		const time = date.toLocaleTimeString( 'fr-CH', { hour: '2-digit', minute: '2-digit' } );
		return sameDay
			? `Vérifié aujourd’hui à ${ time }`
			: `Vérifié le ${ date.toLocaleDateString( 'fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' } ) } à ${ time }`;
	}

	function supplierCostSummary( items ) {
		const prices = ( Array.isArray( items ) ? items : [] ).map( ( item ) => ( {
			amount: Number( item && item.supplier_price && item.supplier_price.amount ),
			currency: String( item && item.supplier_price && item.supplier_price.currency || '' ).toUpperCase(),
		} ) ).filter( ( item ) => Number.isFinite( item.amount ) && item.amount > 0 );
		const currencies = Array.from( new Set( prices.map( ( item ) => item.currency ).filter( Boolean ) ) );
		return {
			count: prices.length,
			currency: currencies.length === 1 ? currencies[0] : '',
			mixedCurrencies: currencies.length > 1,
			min: prices.length ? Math.min( ...prices.map( ( item ) => item.amount ) ) : null,
			max: prices.length ? Math.max( ...prices.map( ( item ) => item.amount ) ) : null,
		};
	}

	function supplierCostLabel( items ) {
		const summary = supplierCostSummary( items );
		if ( ! summary.count ) return 'Non détecté';
		const money = ( amount ) => Number( amount ).toLocaleString( 'fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 } );
		const prefix = summary.mixedCurrencies ? 'Devises mixtes · ' : ( summary.currency ? `${ summary.currency } ` : '' );
		const range = summary.min === summary.max ? money( summary.min ) : `${ money( summary.min ) } → ${ money( summary.max ) }`;
		return `${ prefix }${ range } · ${ summary.count } SKU`;
	}

	function commonSupplierObservation( items ) {
		const rows = Array.isArray( items ) ? items.filter( Boolean ) : [];
		if ( rows.length < 2 ) return '';
		const values = rows.map( ( item ) => String( item && item.observed_at || '' ).trim() );
		if ( values.some( ( value ) => ! value ) ) return '';
		return values.every( ( value ) => value === values[0] ) ? values[0] : '';
	}

	function buildPayload( state ) {
		const normalized = normalizeImagesWithMedia( state.images, state.imageMediaIds );
		return {
			supplier_key: state.supplier_key || 'aliexpress',
			supplier_product_id: state.supplier_product_id || null,
			supplier_url: state.supplier_url || '',
			title: String( state.title || '' ).trim(),
			description_html: state.includeDescription ? ( state.descriptionHtml || '' ) : '',
			images: normalized.images,
			image_media_ids: normalized.mediaIds,
			brand: state.brand || '',
			base_price: { amount: parseFloat( state.priceAmount ), currency: state.priceCurrency || '' },
			availability: state.availability || '',
			rating: state.rating || { value: null, count: null },
			variants: ( state.variantGroups || [] ).flatMap( ( g ) => ( g.options || [] ).filter( ( o ) => o && o.importEnabled !== false ).map( ( o ) => ( {
				supplier_variation_key: `${ slugify( g.sourceAttribute || g.attribute ) }:${ slugify( o.value ) }`,
				dimension_label: targetPricingName( g ),
				source_dimension_label: String( g.sourceAttribute || g.attribute || '' ).trim(),
				target_attribute_type: g.wooTargetType || 'product',
				target_attribute_id: Number( g.wooAttributeId || 0 ),
				target_attribute_taxonomy: String( g.wooTaxonomy || '' ),
				target_attribute_name: targetAttributeName( g ),
				label_raw: targetOptionValue( o ),
				source_label_raw: String( o.value || '' ).trim(),
				image_url: o.imageUrl || null, image_media_id: Number( o.imageMediaId || 0 ) || null,
			} ) ) ),
			attributes: ( state.characteristics || [] ).filter( ( item ) => item && item.selected && String( item.name || '' ).trim() && String( item.value || '' ).trim() ).map( ( item ) => ( {
				name: String( item.name ).trim(), value: String( item.value ).trim(),
				source_label: String( item.source_label || item.name ).trim(), source_value: String( item.source_value || item.value ).trim(),
			} ) ),
			supplier: state.supplier || {},
			supplier_variations: mappedSupplierVariations( state ).variations,
			supplier_sku_source: state.supplierSkuSource || '',
			supplier_sku_captured_at: state.supplierSkuCapturedAt || '',
			supplier_sku_diagnostics: state.supplierSkuDiagnostics || {},
			documents: ( state.documents || [] ).map( ( doc ) => ( {
				type: String( doc.type || 'other' ), title: String( doc.title || 'Document produit' ), source_url: String( doc.source_url || '' ), canonical_url: String( doc.canonical_url || '' ), filename: String( doc.filename || 'document.pdf' ), mime_type: String( doc.mime_type || 'application/pdf' ), language: String( doc.language || '' ), import_to_wordpress: doc.import_to_wordpress !== false, media_id: Number( doc.media_id || 0 ) || null, url: String( doc.url || '' ),
			} ) ),
			size_guide: sizeGuidePayload( state ),
			shipping_current: state.shippingCurrent && typeof state.shippingCurrent === 'object' ? { ...state.shippingCurrent } : null,
			video: state.video && state.video.source_url ? {
				source_url: String( state.video.source_url || '' ),
				thumbnail_url: String( state.video.thumbnail_url || '' ),
				import_to_wordpress: !! state.videoImport,
				add_to_description: !! state.videoAddDescription,
				media_id: Number( state.videoMediaId || 0 ) || null,
				url: String( state.videoWordPressUrl || '' ),
			} : null,
			category_id: state.category_id != null && state.category_id !== '' ? Number( state.category_id ) : null,
		};
	}

	function validatePayload( payload, shopCurrency, extractionSettings ) {
		const errors = [];
		if ( ! String( payload.supplier_key || '' ).trim() || ! String( payload.supplier_product_id || '' ).trim() ) errors.push( 'Identité produit fournisseur manquante.' );
		if ( ! payload.title ) errors.push( 'Titre manquant.' );
		if ( ! payload.base_price || ! ( payload.base_price.amount > 0 ) ) errors.push( 'Prix manquant ou ≤ 0.' );
		const requireImages = ! extractionSettings || extractionSettings.images !== false;
		if ( requireImages && ! payload.images.length ) errors.push( 'Aucune image.' );
		if ( shopCurrency && String( payload.base_price.currency || '' ).toUpperCase() !== String( shopCurrency ).toUpperCase() ) {
			errors.push( `Devise AliExpress ${ payload.base_price.currency || '—' } différente de la devise WooCommerce ${ shopCurrency }.` );
		}
		for ( const group of payload.variants || [] ) {
			if ( ! group.label_raw ) { errors.push( 'Une valeur WooCommerce de variante est vide.' ); break; }
			if ( /^x:/.test( group.supplier_variation_key ) ) { errors.push( 'Un nom d’attribut AliExpress est vide.' ); break; }
			const usesCatalogMapping = Object.prototype.hasOwnProperty.call( group, 'target_attribute_type' ) || Object.prototype.hasOwnProperty.call( group, 'target_attribute_name' );
			if ( usesCatalogMapping && ( ! group.dimension_label || ! group.target_attribute_name ) ) { errors.push( 'Une correspondance d’attribut WooCommerce est incomplète.' ); break; }
		}
		const hasVariationDimensions = ( payload.variants || [] ).some( ( item ) => item && item.label_raw && ! /^x:/.test( String( item.supplier_variation_key || '' ) ) );
		if ( hasVariationDimensions ) {
			if ( ! Array.isArray( payload.supplier_variations ) || ! payload.supplier_variations.length ) errors.push( 'Combinaisons SKU/prix AliExpress non détectées : Constello ne créera pas de variations théoriques.' );
			else if ( payload.supplier_variations.some( ( item ) => ! item.supplier_sku_id || ! item.supplier_price || ! ( Number( item.supplier_price.amount ) > 0 ) ) ) errors.push( 'Un SKU AliExpress ou son prix fournisseur réel est manquant.' );
			const matrix = supplierMatrixCoverage( payload );
			if ( payload.supplier_variations && payload.supplier_variations.length && ! matrix.complete ) {
				if ( matrix.exact && matrix.expectedSkus != null ) errors.push( `Matrice SKU AliExpress incomplète. ${ matrix.verifiedSkus }/${ matrix.expectedSkus } SKU vérifiés. ${ matrix.missing.length } valeur${ matrix.missing.length > 1 ? 's' : '' } sans SKU réel associé.`.replace( /\s+/g, ' ' ).trim() );
				else errors.push( `Matrice SKU AliExpress incomplète. ${ matrix.mappedSkus }/${ matrix.verifiedSkus } SKU réels disposent d’un chemin d’attributs complet.` );
			}
		}

		return { ok: errors.length === 0, errors };
	}

	root.CDHEditor = { slugify, dedupeImages, groupVariants, normalizeSupplierOptionValue, normalizeCharacteristics, supplierPricingCombinations, mappedSupplierVariations, buildPayload, validatePayload, normalizeEditorMediaUrl, isForbiddenMediaUrl, supplierStockSummary, supplierStockLabel, supplierSkuVariantLabel, supplierCostSummary, supplierCostLabel, commonSupplierObservation, formatSupplierObservation, supplierVerificationLabel, supplierMatrixCoverage, stateMatrixCoverage, sizeGuidePayload, supplierShippingSummary, shippingUiLabel };
	if ( typeof document === 'undefined' || ! document.getElementById ) return;

	const $ = ( id ) => document.getElementById( id );
	const els = {
		status: $( 'status' ), main: $( 'main' ), settingsToggle: $( 'settings-toggle' ), settingsPanel: $( 'settings-panel' ), settingsClose: $( 'settings-close' ),
		siteUrlInput: $( 'site-url' ), apiKeyInput: $( 'api-key' ), saveSettingsBtn: $( 'save-settings-btn' ), settingsStatus: $( 'settings-status' ),
		readonlyMeta: $( 'readonly-meta' ), titleInput: $( 'title-input' ), priceInput: $( 'price-input' ), priceCurrencyChip: $( 'price-currency-chip' ), currencyHint: $( 'currency-hint' ),
		imagesEmpty: $( 'images-empty' ), galleryMainImg: $( 'gallery-main-img' ), galleryMainUrl: $( 'gallery-main-url' ), galleryThumbs: $( 'gallery-thumbs' ), addImageBtn: $( 'add-image-btn' ),
		videoCard: $( 'video-card' ), videoPlayer: $( 'video-player' ), videoEmpty: $( 'video-empty' ), videoStatusChip: $( 'video-status-chip' ), includeVideo: $( 'include-video' ), videoAddDescription: $( 'video-add-description' ), videoUseGalleryThumb: $( 'video-use-gallery-thumb' ), videoResetThumb: $( 'video-reset-thumb' ), videoSourceLabel: $( 'video-source-label' ), videoImportNote: $( 'video-import-note' ), mediaCard: $( 'media-card' ), variantsCard: $( 'variants-card' ), categorySelect: $( 'category-select' ), categoryHint: $( 'category-hint' ), categoryPicker: $( 'category-picker' ), categoryTrigger: $( 'category-trigger' ), categoryCurrent: $( 'category-current' ), categoryPanel: $( 'category-panel' ), categorySearch: $( 'category-search' ), categoryOptions: $( 'category-options' ), categoryRecents: $( 'category-recents' ), categoryRecentList: $( 'category-recent-list' ),
		includeDescription: $( 'include-description' ), descriptionInput: $( 'description-input' ), descriptionPreview: $( 'description-preview' ), descriptionState: $( 'description-state' ),
		descriptionMeta: $( 'description-meta' ), descriptionCounts: $( 'description-counts' ), descriptionSourceChip: $( 'description-source-chip' ), descriptionCard: $( 'description-card' ), descriptionPreviewShell: $( 'description-preview-shell' ), descriptionFullscreen: $( 'description-fullscreen' ), descriptionEditor: $( 'description-editor' ), descriptionRemoveImage: $( 'description-remove-image' ), descriptionRestore: $( 'description-restore' ), descriptionDiagnosticsGrid: $( 'description-diagnostics-grid' ),
		variantsExpandAll: $( 'variants-expand-all' ), variantsCollapseAll: $( 'variants-collapse-all' ), characteristicsList: $( 'characteristics-list' ), characteristicsEmpty: $( 'characteristics-empty' ), characteristicsCount: $( 'characteristics-count' ), characteristicsSelectAll: $( 'characteristics-select-all' ), characteristicsSelectNone: $( 'characteristics-select-none' ), characteristicsDeleteAll: $( 'characteristics-delete-all' ),
		variantsEmpty: $( 'variants-empty' ), variantGroups: $( 'variant-groups' ), addGroupBtn: $( 'add-group-btn' ),
		pricingSourceState: $( 'pricing-source-state' ), pricingCount: $( 'pricing-count' ), pricingPreview: $( 'pricing-preview' ),
		footerErrors: $( 'footer-errors' ), reanalyzeBtn: $( 'reanalyze-btn' ), importBtn: $( 'import-btn' ), destinationSite: $( 'destination-site' ), headerSource: $( 'header-source' ),
		mediaImageCount: $( 'media-image-count' ), mediaVideoCount: $( 'media-video-count' ), galleryMainState: $( 'gallery-main-state' ),
		galleryPreviewBadge: $( 'gallery-preview-badge' ), gallerySelectionTitle: $( 'gallery-selection-title' ), gallerySelectionSubtitle: $( 'gallery-selection-subtitle' ),
		setMainBtn: $( 'set-main-btn' ), galleryMoveLeft: $( 'gallery-move-left' ), galleryMoveRight: $( 'gallery-move-right' ), galleryDeleteSelected: $( 'gallery-delete-selected' ),
		documentsCard: $( 'documents-card' ), documentsList: $( 'documents-list' ), documentsEmpty: $( 'documents-empty' ), documentsCount: $( 'documents-count' ), workspaceNav: $( 'workspace-nav' ), workspaceNavReset: $( 'workspace-nav-reset' ), workspaceSettingsReset: $( 'workspace-settings-reset' ),
	};

	let state = null;
	let selectedDescriptionImage = null;
	let shopConfig = null;
	let loadedCategories = [];
	let urlCategoryId = null;
	let urlOpenSettings = false;
	let selectedImageIndex = 0;

	function setStatus( text, kind ) { els.status.textContent = text; els.status.className = 'status' + ( kind ? ' status--' + kind : '' ); }
	function getSourceTabId() { const id = parseInt( new URLSearchParams( location.search ).get( 'sourceTabId' ), 10 ); return Number.isNaN( id ) ? null : id; }
	function readUrlParams() { const p = new URLSearchParams( location.search ); const id = parseInt( p.get( 'categoryId' ), 10 ); urlCategoryId = Number.isNaN( id ) ? null : id; urlOpenSettings = p.get( 'openSettings' ) === '1'; }
	function normalizeSiteUrl( raw ) { if ( ! raw ) return ''; let url = String( raw ).trim(); if ( ! /^https?:\/\//i.test( url ) ) url = 'https://' + url; return url.replace( /\/+$/, '' ); }
	function esc( text ) { const div = document.createElement( 'div' ); div.textContent = String( text ); return div.innerHTML; }
	function decodeHtmlEntities( value ) {
		const textarea = document.createElement( 'textarea' );
		textarea.innerHTML = String( value == null ? '' : value );
		return textarea.value;
	}
	function isLocalImage( url ) { return /^data:image\//i.test( String( url || '' ) ); }

	function applyTheme( theme ) {
		const allowed = [ 'system', 'light', 'dark' ];
		const value = allowed.includes( theme ) ? theme : 'system';
		document.documentElement.dataset.theme = value;
		document.querySelectorAll( '[data-theme-choice]' ).forEach( ( btn ) => {
			btn.classList.toggle( 'is-active', btn.dataset.themeChoice === value );
			btn.setAttribute( 'aria-pressed', btn.dataset.themeChoice === value ? 'true' : 'false' );
		} );
	}


	const WORKSPACE_ORDER_KEY = 'cdh_workspace_order_v1';
	const DEFAULT_WORKSPACE_ORDER = [ 'media', 'variants', 'pricing', 'documents', 'description', 'characteristics' ];

	function normalizeWorkspaceOrder( raw ) {
		const allowed = new Set( DEFAULT_WORKSPACE_ORDER );
		const out = [];
		for ( const value of Array.isArray( raw ) ? raw : [] ) { const key = String( value || '' ); if ( allowed.has( key ) && ! out.includes( key ) ) out.push( key ); }
		for ( const key of DEFAULT_WORKSPACE_ORDER ) if ( ! out.includes( key ) ) out.push( key );
		return out;
	}

	function applyWorkspaceOrder( rawOrder ) {
		const order = normalizeWorkspaceOrder( rawOrder );
		const product = document.querySelector( '[data-workspace-section="product"]' );
		const stack = product && product.parentElement;
		if ( stack ) for ( const key of order ) { const card = document.querySelector( `[data-workspace-section="${ key }"]` ); if ( card ) stack.appendChild( card ); }
		if ( els.workspaceNav ) {
			const reset = els.workspaceNavReset;
			for ( const key of order ) { const chip = els.workspaceNav.querySelector( `[data-workspace-nav="${ key }"]` ); if ( chip ) els.workspaceNav.insertBefore( chip, reset || null ); }
		}
		return order;
	}

	async function saveWorkspaceOrder( order ) {
		const normalized = applyWorkspaceOrder( order );
		try { await chrome.storage.local.set( { [ WORKSPACE_ORDER_KEY ]: normalized } ); } catch ( e ) {}
		return normalized;
	}

	async function loadWorkspaceOrder() {
		let stored = null;
		try { const values = await chrome.storage.local.get( [ WORKSPACE_ORDER_KEY ] ); stored = values[ WORKSPACE_ORDER_KEY ]; } catch ( e ) {}
		applyWorkspaceOrder( stored );
	}

	async function resetWorkspaceOrder() { await saveWorkspaceOrder( DEFAULT_WORKSPACE_ORDER ); }

	function bindWorkspaceNavigation() {
		if ( ! els.workspaceNav ) return;
		let draggingKey = ''; let suppressClickUntil = 0;
		els.workspaceNav.querySelectorAll( '[data-workspace-nav]' ).forEach( ( chip ) => {
			chip.addEventListener( 'click', () => { if ( Date.now() < suppressClickUntil ) return; const card = document.querySelector( `[data-workspace-section="${ chip.dataset.workspaceNav }"]` ); if ( card ) card.scrollIntoView( { behavior: 'smooth', block: 'start' } ); } );
			if ( chip.getAttribute( 'draggable' ) !== 'true' ) return;
			chip.addEventListener( 'dragstart', ( event ) => { draggingKey = chip.dataset.workspaceNav || ''; chip.classList.add( 'is-dragging' ); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData( 'text/plain', draggingKey ); } );
			chip.addEventListener( 'dragend', () => { draggingKey = ''; suppressClickUntil = Date.now() + 220; chip.classList.remove( 'is-dragging' ); els.workspaceNav.querySelectorAll( '.is-dragover' ).forEach( ( item ) => item.classList.remove( 'is-dragover' ) ); } );
			chip.addEventListener( 'dragover', ( event ) => { if ( ! draggingKey || draggingKey === chip.dataset.workspaceNav ) return; event.preventDefault(); chip.classList.add( 'is-dragover' ); } );
			chip.addEventListener( 'dragleave', () => chip.classList.remove( 'is-dragover' ) );
			chip.addEventListener( 'drop', async ( event ) => {
				event.preventDefault(); chip.classList.remove( 'is-dragover' );
				const source = event.dataTransfer.getData( 'text/plain' ) || draggingKey; const target = chip.dataset.workspaceNav || '';
				if ( ! source || ! target || source === target ) return;
				const chips = Array.from( els.workspaceNav.querySelectorAll( '[data-workspace-nav][draggable="true"]' ) ).map( ( item ) => item.dataset.workspaceNav );
				const from = chips.indexOf( source ), to = chips.indexOf( target ); if ( from < 0 || to < 0 ) return;
				chips.splice( from, 1 ); chips.splice( to, 0, source ); await saveWorkspaceOrder( chips );
			} );
		} );
		if ( els.workspaceNavReset ) els.workspaceNavReset.addEventListener( 'click', resetWorkspaceOrder );
		if ( els.workspaceSettingsReset ) els.workspaceSettingsReset.addEventListener( 'click', resetWorkspaceOrder );
		if ( typeof IntersectionObserver !== 'undefined' ) {
			const observer = new IntersectionObserver( ( entries ) => {
				const visible = entries.filter( ( entry ) => entry.isIntersecting ).sort( ( a, b ) => b.intersectionRatio - a.intersectionRatio )[0];
				if ( ! visible ) return; const key = visible.target.dataset.workspaceSection;
				els.workspaceNav.querySelectorAll( '[data-workspace-nav]' ).forEach( ( chip ) => chip.classList.toggle( 'is-active', chip.dataset.workspaceNav === key ) );
			}, { rootMargin: '-120px 0px -62% 0px', threshold: [ .05, .25, .5 ] } );
			document.querySelectorAll( '[data-workspace-section]' ).forEach( ( card ) => observer.observe( card ) );
		}
	}

	async function loadTheme() {
		const stored = await chrome.storage.local.get( [ 'constello_theme' ] );
		applyTheme( stored.constello_theme || 'system' );
	}

	async function setTheme( theme ) {
		applyTheme( theme );
		await chrome.storage.local.set( { constello_theme: theme } );
	}

	async function loadSettings() {
		const values = await chrome.storage.local.get( [ 'cdh_site_url', 'cdh_api_key' ] );
		els.siteUrlInput.value = values.cdh_site_url || '';
		els.apiKeyInput.value = values.cdh_api_key || '';
		updateDestination();
	}

	async function saveSettings() {
		const site_url = normalizeSiteUrl( els.siteUrlInput.value );
		const api_key = els.apiKeyInput.value.trim();
		if ( ! site_url || ! api_key ) { els.settingsStatus.textContent = 'URL et clé API requises.'; return; }
		els.saveSettingsBtn.disabled = true; els.settingsStatus.textContent = 'Connexion…';
		let response = null;
		try { response = await chrome.runtime.sendMessage( { type: 'CDH_SAVE_SETTINGS', payload: { site_url, api_key, theme: document.documentElement.dataset.theme || 'system' } } ); } catch ( e ) {}
		els.saveSettingsBtn.disabled = false;
		if ( ! response || ! response.ok ) { els.settingsStatus.textContent = response && response.message ? response.message : 'Connexion WordPress impossible.'; return; }
		els.siteUrlInput.value = response.site_url || site_url;
		els.settingsStatus.textContent = 'Connexion enregistrée.';
		await Promise.all( [ loadShopConfig(), loadCategoryOptions() ] );
		updateValidation();
		setTimeout( () => { els.settingsStatus.textContent = ''; }, 1800 );
	}


	async function loadShopConfig() {
		let response;
		try { response = await chrome.runtime.sendMessage( { type: 'CDH_GET_CONFIG' } ); } catch ( err ) { response = null; }
		shopConfig = response && response.ok ? response.config : null;
		updateDestination();
		updateCurrencyUi();
		applyExtractionVisibility();
	}

	function extractionEnabled( key, fallback = true ) {
		const cfg = shopConfig && shopConfig.extraction ? shopConfig.extraction : null;
		return ! cfg || cfg[ key ] === undefined ? fallback : cfg[ key ] !== false;
	}
	function applyExtractionVisibility() {
		if ( els.descriptionCard ) els.descriptionCard.hidden = ! extractionEnabled( 'description', true );
		if ( els.variantsCard ) els.variantsCard.hidden = ! extractionEnabled( 'variants', true );
		if ( $( 'pricing-card' ) ) $( 'pricing-card' ).hidden = ! extractionEnabled( 'variants', true );
		if ( $( 'characteristics-card' ) ) $( 'characteristics-card' ).hidden = ! extractionEnabled( 'characteristics', true );
		if ( els.mediaCard ) els.mediaCard.hidden = ! extractionEnabled( 'images', true ) && ! extractionEnabled( 'video', true );
		if ( els.documentsCard ) els.documentsCard.hidden = ! extractionEnabled( 'documents', true );
		const navVisibility = { media: extractionEnabled( 'images', true ) || extractionEnabled( 'video', true ), variants: extractionEnabled( 'variants', true ), pricing: extractionEnabled( 'variants', true ), documents: extractionEnabled( 'documents', true ), description: extractionEnabled( 'description', true ), characteristics: extractionEnabled( 'characteristics', true ) }; if ( els.workspaceNav ) Object.entries( navVisibility ).forEach( ( [ key, visible ] ) => { const chip = els.workspaceNav.querySelector( `[data-workspace-nav="${ key }"]` ); if ( chip ) chip.hidden = ! visible; } );
		const imageTab = document.querySelector( '[data-media-tab="images"]' ), videoTab = document.querySelector( '[data-media-tab="video"]' );
		if ( imageTab ) imageTab.hidden = ! extractionEnabled( 'images', true );
		if ( videoTab ) videoTab.hidden = ! extractionEnabled( 'video', true );
	}

	function updateDestination() {
		const raw = normalizeSiteUrl( els.siteUrlInput.value );
		let host = raw || 'Site WordPress non configuré';
		try { host = new URL( raw ).host; } catch ( e ) {}
		els.destinationSite.textContent = shopConfig && shopConfig.site_name ? `${ shopConfig.site_name } · ${ host }` : host;
	}

	function updateCurrencyUi() {
		const supplier = state && state.priceCurrency ? String( state.priceCurrency ).toUpperCase() : '—';
		const shop = shopConfig && shopConfig.currency ? String( shopConfig.currency ).toUpperCase() : '';
		els.priceCurrencyChip.textContent = supplier;
		if ( ! shop ) els.currencyHint.textContent = supplier !== '—' ? `Devise détectée sur AliExpress : ${ supplier }.` : '';
		else if ( supplier === shop ) els.currencyHint.textContent = `Devise conforme à WooCommerce (${ shop }).`;
		else els.currencyHint.textContent = `WooCommerce utilise ${ shop }. Configure AliExpress en ${ shop } puis ré-analyse la fiche.`;
	}

	function renderMeta( data ) {
		const items = [
			data.supplier && data.supplier.store_name ? `Boutique · ${ data.supplier.store_name }` : null,
			data.brand ? `Marque · ${ data.brand }` : null,
			data.availability ? `Stock · ${ String( data.availability ).replace( /_/g, ' ' ) }` : null,
			data.rating && data.rating.value != null ? `★ ${ data.rating.value }/5 · ${ data.rating.count || 0 } avis` : null,
			data.supplier_product_id ? `ID · ${ data.supplier_product_id }` : null,
		].filter( Boolean );
		els.readonlyMeta.innerHTML = items.map( ( item ) => `<span class="meta-pill">${ esc( item ) }</span>` ).join( '' );
	}

	function moveImage( from, to ) {
		// L’image principale (index 0) est volontairement épinglée : le réordonnancement
		// des images secondaires ne peut pas changer silencieusement l’image principale.
		if ( ! state || from === to || from <= 0 || to <= 0 || from >= state.images.length || to >= state.images.length ) return;
		const [ image ] = state.images.splice( from, 1 );
		const [ mediaId ] = state.imageMediaIds.splice( from, 1 );
		state.images.splice( to, 0, image );
		state.imageMediaIds.splice( to, 0, mediaId || null );
		if ( selectedImageIndex === from ) selectedImageIndex = to;
		else if ( from < selectedImageIndex && to >= selectedImageIndex ) selectedImageIndex--;
		else if ( from > selectedImageIndex && to <= selectedImageIndex ) selectedImageIndex++;
		renderGallery();
		updateValidation();
	}

	function setSelectedAsMain() {
		if ( ! state || selectedImageIndex <= 0 || selectedImageIndex >= state.images.length ) return;
		const from = selectedImageIndex;
		const [ image ] = state.images.splice( from, 1 );
		const [ mediaId ] = state.imageMediaIds.splice( from, 1 );
		state.images.unshift( image );
		state.imageMediaIds.unshift( mediaId || null );
		selectedImageIndex = 0;
		renderGallery();
		updateValidation();
	}

	function removeSelectedImage() {
		if ( ! state || ! state.images.length ) return;
		state.images.splice( selectedImageIndex, 1 );
		state.imageMediaIds.splice( selectedImageIndex, 1 );
		selectedImageIndex = Math.max( 0, Math.min( selectedImageIndex, state.images.length - 1 ) );
		renderGallery();
		updateValidation();
	}

	function duplicateSelectedImage() {
		if ( ! state || ! state.images.length ) return;
		const source = state.images[ selectedImageIndex ];
		if ( ! source ) return;
		const insertAt = selectedImageIndex + 1;
		state.images.splice( insertAt, 0, source );
		state.imageMediaIds.splice( insertAt, 0, null );
		selectedImageIndex = insertAt;
		renderGallery();
		updateValidation();
	}

	function renderGallery() {
		const images = state.images || [];
		els.imagesEmpty.hidden = images.length > 0;
		if ( ! images.length ) selectedImageIndex = 0;
		else selectedImageIndex = Math.max( 0, Math.min( selectedImageIndex, images.length - 1 ) );
		const selectedUrl = images[ selectedImageIndex ] || '';
		const isMain = selectedImageIndex === 0 && !! selectedUrl;

		els.galleryMainImg.src = selectedUrl;
		els.galleryMainImg.style.visibility = selectedUrl ? 'visible' : 'hidden';
		els.galleryMainUrl.value = selectedUrl;
		els.galleryMainState.textContent = isLocalImage( selectedUrl ) ? 'Modifiée localement' : '';
		els.galleryPreviewBadge.textContent = isMain ? 'Principale' : ( selectedUrl ? `Aperçu · Image ${ selectedImageIndex + 1 }` : 'Aperçu' );
		els.galleryPreviewBadge.classList.toggle( 'is-main', isMain );
		els.gallerySelectionTitle.textContent = isMain ? 'Image principale' : ( selectedUrl ? `Image ${ selectedImageIndex + 1 } sélectionnée` : 'Aucune image' );
		els.gallerySelectionSubtitle.textContent = isMain
			? 'Première image envoyée à WooCommerce'
			: ( selectedUrl ? 'Prévisualisation uniquement · définis-la comme principale si nécessaire' : 'Ajoute une image pour commencer' );
		els.setMainBtn.hidden = ! selectedUrl || isMain;
		els.galleryMoveLeft.disabled = ! selectedUrl || selectedImageIndex <= 1;
		els.galleryMoveRight.disabled = ! selectedUrl || selectedImageIndex === 0 || selectedImageIndex >= images.length - 1;
		els.galleryDeleteSelected.disabled = ! selectedUrl;

		els.galleryThumbs.innerHTML = '';
		images.forEach( ( url, idx ) => {
			const thumb = document.createElement( 'div' );
			thumb.className = 'gallery-thumb' + ( idx === selectedImageIndex ? ' gallery-thumb--selected' : '' );
			thumb.tabIndex = 0;
			thumb.draggable = !! url && idx !== 0;
			thumb.setAttribute( 'role', 'button' );
			thumb.setAttribute( 'aria-label', idx === 0 ? `Image ${ idx + 1 }, principale` : `Image ${ idx + 1 }` );
			const img = document.createElement( 'img' ); img.src = url; img.alt = idx === 0 ? 'Image principale' : `Image ${ idx + 1 }`; thumb.appendChild( img );

			const indexBadge = document.createElement( 'span' ); indexBadge.className = 'gallery-thumb-index'; indexBadge.textContent = String( idx + 1 ); thumb.appendChild( indexBadge );
			if ( idx === 0 ) { const badge = document.createElement( 'span' ); badge.className = 'gallery-thumb-main-badge'; badge.textContent = 'Principale'; thumb.appendChild( badge ); }

			const select = () => { selectedImageIndex = idx; renderGallery(); };
			thumb.addEventListener( 'click', select );
			thumb.addEventListener( 'keydown', ( e ) => { if ( e.key === 'Enter' || e.key === ' ' ) { e.preventDefault(); select(); } } );
			thumb.addEventListener( 'dragstart', ( e ) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData( 'text/plain', String( idx ) ); } );
			thumb.addEventListener( 'dragover', ( e ) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; thumb.classList.add( 'gallery-thumb--dragover' ); } );
			thumb.addEventListener( 'dragleave', () => thumb.classList.remove( 'gallery-thumb--dragover' ) );
			thumb.addEventListener( 'drop', ( e ) => { e.preventDefault(); thumb.classList.remove( 'gallery-thumb--dragover' ); const from = parseInt( e.dataTransfer.getData( 'text/plain' ), 10 ); if ( idx > 0 && ! Number.isNaN( from ) ) moveImage( from, idx ); } );
			thumb.addEventListener( 'dragend', () => document.querySelectorAll( '.gallery-thumb--dragover' ).forEach( ( el ) => el.classList.remove( 'gallery-thumb--dragover' ) ) );

			const remove = document.createElement( 'button' );
			remove.type = 'button'; remove.className = 'gallery-thumb-remove'; remove.title = 'Supprimer cette image'; remove.setAttribute( 'aria-label', `Supprimer l’image ${ idx + 1 }` );
			remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>';
			remove.addEventListener( 'click', ( e ) => { e.stopPropagation(); selectedImageIndex = idx; removeSelectedImage(); } );
			thumb.appendChild( remove );
			els.galleryThumbs.appendChild( thumb );
		} );
		els.mediaImageCount.textContent = images.length ? `(${ images.length })` : '';
	}



	function renderDocuments() {
		if ( ! els.documentsList || ! els.documentsEmpty || ! els.documentsCount ) return;
		const docs = state && Array.isArray( state.documents ) ? state.documents : [];
		els.documentsList.innerHTML = '';
		els.documentsEmpty.hidden = docs.length > 0;
		els.documentsCount.textContent = `${ docs.length } détecté${ docs.length > 1 ? 's' : '' }`;
		docs.forEach( ( doc, index ) => {
			if ( doc.import_to_wordpress === undefined ) doc.import_to_wordpress = true;
			const row = document.createElement( 'div' ); row.className = 'document-row';
			const main = document.createElement( 'div' ); main.className = 'document-main';
			const icon = document.createElement( 'span' ); icon.className = 'document-icon'; icon.textContent = 'PDF';
			const copy = document.createElement( 'div' ); copy.className = 'document-copy'; const strong = document.createElement( 'strong' ); strong.textContent = doc.title || 'Document produit'; const meta = document.createElement( 'span' ); meta.textContent = [ 'PDF', doc.language ? String( doc.language ).toUpperCase() : '', doc.media_id ? 'Médiathèque WordPress' : 'AliExpress' ].filter( Boolean ).join( ' · ' ); copy.append( strong, meta ); main.append( icon, copy );
			const actions = document.createElement( 'div' ); actions.className = 'document-actions';
			const view = document.createElement( 'button' ); view.type = 'button'; view.className = 'document-view'; view.textContent = 'Voir'; view.addEventListener( 'click', () => { try { const u = new URL( doc.source_url ); if ( u.protocol === 'https:' ) chrome.tabs.create( { url: u.href } ); } catch ( e ) {} } );
			const toggle = document.createElement( 'label' ); toggle.className = 'include-toggle'; const input = document.createElement( 'input' ); input.type = 'checkbox'; input.checked = doc.import_to_wordpress !== false; const track = document.createElement( 'span' ); track.className = 'switch-track'; const text = document.createElement( 'span' ); text.textContent = 'Importer'; toggle.append( input, track, text ); input.addEventListener( 'change', () => { doc.import_to_wordpress = input.checked; updateValidation(); } );
			actions.append( view, toggle ); row.append( main, actions ); els.documentsList.appendChild( row );
		} );
	}

	function renderCharacteristics() {
		const items = state && Array.isArray( state.characteristics ) ? state.characteristics : [];
		els.characteristicsList.innerHTML = '';
		els.characteristicsEmpty.hidden = items.length > 0;
		const selectedCount = items.filter( ( item ) => item.selected ).length;
		els.characteristicsCount.textContent = `${ items.length } détectée${ items.length > 1 ? 's' : '' } · ${ selectedCount } sélectionnée${ selectedCount > 1 ? 's' : '' }`;
		items.forEach( ( item, index ) => {
			const row = document.createElement( 'div' ); row.className = 'characteristic-row' + ( item.selected ? '' : ' is-excluded' );
			const check = document.createElement( 'input' ); check.type = 'checkbox'; check.checked = !! item.selected; check.title = 'Inclure cette caractéristique dans WooCommerce';
			check.addEventListener( 'change', () => { item.selected = check.checked; renderCharacteristics(); updateValidation(); } );
			const name = document.createElement( 'input' ); name.type = 'text'; name.className = 'characteristic-name'; name.value = item.name; name.placeholder = 'Nom de l’attribut';
			name.addEventListener( 'input', () => { item.name = name.value; updateValidation(); } );
			const value = document.createElement( 'input' ); value.type = 'text'; value.className = 'characteristic-value'; value.value = item.value; value.placeholder = 'Valeur';
			value.addEventListener( 'input', () => { item.value = value.value; updateValidation(); } );
			const remove = document.createElement( 'button' ); remove.type = 'button'; remove.className = 'characteristic-remove'; remove.title = 'Supprimer cette caractéristique'; remove.setAttribute( 'aria-label', 'Supprimer cette caractéristique' );
			remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>';
			remove.addEventListener( 'click', () => { state.characteristics.splice( index, 1 ); renderCharacteristics(); updateValidation(); } );
			row.append( check, name, value, remove ); els.characteristicsList.appendChild( row );
		} );
	}

	function supplierOptionUsedByRealSku( group, opt ) {
		const rows = state && Array.isArray( state.supplierVariations ) ? state.supplierVariations : [];
		const propertyId = String( group && group.sourcePropertyId || '' );
		const valueId = String( opt && opt.sourceValueId || '' );
		const label = slugify( opt && opt.value || '' );
		return rows.some( ( row ) => ( Array.isArray( row && row.attributes ) ? row.attributes : [] ).some( ( attr ) => {
			if ( propertyId && attr && attr.property_id && String( attr.property_id ) !== propertyId ) return false;
			if ( valueId && attr && attr.value_id && String( attr.value_id ) === valueId ) return true;
			return !! label && slugify( attr && attr.value || '' ) === label;
		} ) );
	}


	function sizeGuideForGroup( group ) {
		const guide = state && state.sizeGuide;
		if ( ! guide ) return null;
		const propertyId = String( guide.source_property_id || '' );
		const groupId = String( group && group.sourcePropertyId || '' );
		if ( propertyId && groupId ) return propertyId === groupId ? guide : null;
		return slugify( guide.source_attribute || '' ) === slugify( group && ( group.sourceAttribute || group.attribute ) || '' ) ? guide : null;
	}

	function sizeGuideColumns( guide ) {
		const out = [];
		for ( const size of Array.isArray( guide && guide.sizes ) ? guide.sizes : [] ) {
			for ( const measurement of Array.isArray( size.measurements ) ? size.measurements : [] ) {
				const name = String( measurement && measurement.name || '' ).trim();
				if ( name && ! out.some( ( item ) => slugify( item ) === slugify( name ) ) ) out.push( name );
			}
		}
		return out;
	}

	function sizeGuideColumnLabel( guide, group, column ) {
		const label = String( column || '' ).trim();
		const attr = targetAttributeName( group ) || String( guide && ( guide.target_attribute || guide.source_attribute ) || '' );
		if ( slugify( label ) && slugify( label ) === slugify( attr ) && /^(?:taille|size)$/i.test( label ) ) return 'Tour de taille';
		return label;
	}

	function sizeGuideColumnUnit( guide, column ) {
		const counts = new Map();
		for ( const size of Array.isArray( guide && guide.sizes ) ? guide.sizes : [] ) {
			const measurement = ( size.measurements || [] ).find( ( item ) => slugify( item && item.name || '' ) === slugify( column ) );
			const unit = String( measurement && measurement.unit || '' ).trim();
			if ( unit ) counts.set( unit, ( counts.get( unit ) || 0 ) + 1 );
		}
		return Array.from( counts.entries() ).sort( ( a, b ) => b[1] - a[1] )[0]?.[0] || '';
	}

	function sizeGuideMeasurementText( measurement ) {
		if ( ! measurement ) return '';
		if ( measurement.value_type === 'range' || ( measurement.min != null && measurement.max != null ) ) {
			const min = Number( measurement.min ), max = Number( measurement.max );
			if ( Number.isFinite( min ) && Number.isFinite( max ) ) return `${ min }–${ max }`;
		}
		if ( measurement.value !== null && measurement.value !== undefined && String( measurement.value ).trim() !== '' ) return String( measurement.value );
		return '';
	}

	function parseManualSizeMeasurement( raw, unit ) {
		const normalized = String( raw || '' ).trim().replace( /[–—−]/g, '-' );
		if ( ! normalized ) return null;
		let match = normalized.match( /^([\d.,]+)\s*-\s*([\d.,]+)$/ );
		if ( match ) {
			const min = Number( match[1].replace( ',', '.' ) ), max = Number( match[2].replace( ',', '.' ) );
			if ( ! Number.isFinite( min ) || ! Number.isFinite( max ) || min <= 0 || max <= 0 || min > max ) return false;
			return { value_type: 'range', value: null, min, max, unit: String( unit || '' ) };
		}
		match = normalized.match( /^([\d.,]+)$/ );
		if ( ! match ) return false;
		const value = Number( match[1].replace( ',', '.' ) );
		if ( ! Number.isFinite( value ) || value <= 0 ) return false;
		return { value_type: 'single', value, min: null, max: null, unit: String( unit || '' ) };
	}

	function supplierMeasurementEquals( measurement, parsed ) {
		if ( ! measurement || ! parsed ) return false;
		if ( parsed.value_type === 'range' ) {
			return measurement.supplier_min != null && measurement.supplier_max != null && Number( measurement.supplier_min ) === Number( parsed.min ) && Number( measurement.supplier_max ) === Number( parsed.max ) && String( measurement.supplier_unit || measurement.unit || '' ) === String( parsed.unit || '' );
		}
		return measurement.supplier_value != null && Number( measurement.supplier_value ) === Number( parsed.value ) && String( measurement.supplier_unit || measurement.unit || '' ) === String( parsed.unit || '' );
	}

	function restoreSupplierMeasurement( measurement ) {
		if ( ! measurement ) return;
		if ( measurement.supplier_min != null && measurement.supplier_max != null ) {
			measurement.value_type = 'range'; measurement.value = null; measurement.min = Number( measurement.supplier_min ); measurement.max = Number( measurement.supplier_max );
		} else {
			measurement.value_type = 'single'; measurement.value = measurement.supplier_value; measurement.min = null; measurement.max = null;
		}
		measurement.unit = measurement.supplier_unit || measurement.unit || '';
		measurement.source = 'aliexpress'; measurement.manual_updated_at = '';
	}

	function renderSizeGuideForGroup( group ) {
		const guide = sizeGuideForGroup( group );
		if ( ! guide || ! Array.isArray( guide.sizes ) || ! guide.sizes.length ) return null;
		const details = document.createElement( 'details' ); details.className = 'size-guide-details';
		const documented = guide.sizes.filter( ( size ) => Array.isArray( size.measurements ) && size.measurements.length ).length;
		const incomplete = Math.max( 0, guide.sizes.length - documented );
		const summary = document.createElement( 'summary' ); summary.textContent = 'Guide des tailles détecté';
		const summaryMeta = document.createElement( 'span' ); summaryMeta.className = 'size-guide-summary-meta';
		const meta = document.createElement( 'span' ); meta.textContent = `${ documented }/${ guide.sizes.length } taille${ guide.sizes.length > 1 ? 's' : '' } documentée${ documented > 1 ? 's' : '' }`; summaryMeta.appendChild( meta );
		if ( incomplete ) { const warning = document.createElement( 'span' ); warning.className = 'size-guide-incomplete'; warning.textContent = `${ incomplete } taille${ incomplete > 1 ? 's' : '' } à compléter`; summaryMeta.appendChild( warning ); }
		summary.appendChild( summaryMeta ); details.appendChild( summary );
		const columns = sizeGuideColumns( guide );
		const wrap = document.createElement( 'div' ); wrap.className = 'size-guide-table-wrap';
		const table = document.createElement( 'table' ); table.className = 'size-guide-table';
		const head = document.createElement( 'thead' ); const hr = document.createElement( 'tr' );
		const headerLabel = targetAttributeName( group ) || String( guide.target_attribute || guide.source_attribute || 'Taille' );
		[ headerLabel || 'Taille', ...columns.map( ( column ) => sizeGuideColumnLabel( guide, group, column ) ) ].forEach( ( name ) => { const th = document.createElement( 'th' ); th.textContent = name; hr.appendChild( th ); } ); head.appendChild( hr ); table.appendChild( head );
		const body = document.createElement( 'tbody' );
		for ( const size of guide.sizes ) {
			const tr = document.createElement( 'tr' );
			const first = document.createElement( 'td' ); first.className = 'size-guide-size-cell';
			const option = ( group.options || [] ).find( ( item ) => {
				if ( size.source_value_id && item.sourceValueId ) return String( item.sourceValueId ) === String( size.source_value_id );
				return slugify( item.value || '' ) === slugify( size.source_value || '' );
			} );
			const targetLabel = option ? targetOptionValue( option ) : String( size.target_value || size.source_value || '—' );
			const strong = document.createElement( 'strong' ); strong.textContent = targetLabel || '—'; first.appendChild( strong );
			if ( targetLabel && String( size.source_value || '' ) && targetLabel !== String( size.source_value ) ) { const source = document.createElement( 'small' ); source.textContent = `Source : ${ size.source_value }`; first.appendChild( source ); }
			if ( ! Array.isArray( size.measurements ) || ! size.measurements.length ) { const missing = document.createElement( 'small' ); missing.className = 'size-guide-missing'; missing.textContent = 'Mesures non disponibles · saisie manuelle possible'; first.appendChild( missing ); }
			tr.appendChild( first );
			for ( const column of columns ) {
				const td = document.createElement( 'td' );
				let measurement = ( size.measurements || [] ).find( ( item ) => slugify( item && item.name || '' ) === slugify( column ) );
				const cell = document.createElement( 'div' ); cell.className = 'size-guide-measure-cell';
				const input = document.createElement( 'input' ); input.type = 'text'; input.inputMode = 'decimal'; input.className = 'size-guide-measure-input'; input.placeholder = '+'; input.title = measurement ? 'Valeur simple ou plage, ex. 94 ou 160-166' : 'Ajouter une mesure, ex. 94 ou 160-166'; input.value = sizeGuideMeasurementText( measurement );
				const fallbackUnit = sizeGuideColumnUnit( guide, column );
				const unit = document.createElement( 'span' ); unit.className = 'size-guide-unit'; unit.textContent = String( measurement && measurement.unit || fallbackUnit || '' );
				cell.append( input, unit );
				if ( measurement ) {
					if ( ! measurement.source ) measurement.source = 'aliexpress';
					if ( measurement.source === 'aliexpress' ) {
						if ( measurement.value_type === 'range' || ( measurement.min != null && measurement.max != null ) ) {
							if ( measurement.supplier_min == null ) measurement.supplier_min = measurement.min; if ( measurement.supplier_max == null ) measurement.supplier_max = measurement.max;
						} else if ( measurement.supplier_value == null ) measurement.supplier_value = measurement.value;
						if ( ! measurement.supplier_unit ) measurement.supplier_unit = measurement.unit || fallbackUnit || '';
					}
					if ( measurement.source === 'manual' ) { const sourceBadge = document.createElement( 'span' ); sourceBadge.className = 'size-guide-source is-manual'; sourceBadge.textContent = 'Manuel'; cell.appendChild( sourceBadge ); }
					if ( measurement.unit_conflict ) { const conflict = document.createElement( 'span' ); conflict.className = 'size-guide-source is-warning'; conflict.textContent = '⚠'; conflict.title = `Source AliExpress : ${ measurement.raw_value || '' } · unité retenue : ${ measurement.unit || '' }`; cell.appendChild( conflict ); }
					if ( measurement.source === 'manual' && ( measurement.supplier_value != null || ( measurement.supplier_min != null && measurement.supplier_max != null ) ) ) {
						const restore = document.createElement( 'button' ); restore.type = 'button'; restore.className = 'size-guide-restore'; restore.textContent = '↺'; restore.title = 'Restaurer la mesure fournisseur'; restore.addEventListener( 'click', () => { restoreSupplierMeasurement( measurement ); renderVariantGroups(); updateValidation(); } ); cell.appendChild( restore );
					}
				}
				input.addEventListener( 'change', () => {
					const raw = String( input.value || '' ).trim();
					measurement = ( size.measurements || [] ).find( ( item ) => slugify( item && item.name || '' ) === slugify( column ) );
					if ( ! raw ) {
						if ( measurement && measurement.source === 'manual' && measurement.supplier_value == null && measurement.supplier_min == null ) size.measurements = ( size.measurements || [] ).filter( ( item ) => item !== measurement );
						renderVariantGroups(); updateValidation(); return;
					}
					const chosenUnit = String( measurement && measurement.unit || fallbackUnit || '' );
					const parsed = parseManualSizeMeasurement( raw, chosenUnit );
					if ( ! parsed ) { input.classList.add( 'is-invalid' ); return; }
					if ( ! Array.isArray( size.measurements ) ) size.measurements = [];
					if ( ! measurement ) {
						measurement = { name: column, ...parsed, raw_value: raw, raw_unit: '', unit_source: chosenUnit ? 'column' : '', unit_conflict: false, source: 'manual', supplier_value: null, supplier_min: null, supplier_max: null, supplier_unit: '', supplier_raw_value: '', manual_updated_at: new Date().toISOString() };
						size.measurements.push( measurement );
					} else {
						if ( measurement.source !== 'manual' ) {
							if ( measurement.value_type === 'range' || ( measurement.min != null && measurement.max != null ) ) { if ( measurement.supplier_min == null ) measurement.supplier_min = measurement.min; if ( measurement.supplier_max == null ) measurement.supplier_max = measurement.max; }
							else if ( measurement.supplier_value == null ) measurement.supplier_value = measurement.value;
							if ( ! measurement.supplier_unit ) measurement.supplier_unit = measurement.unit || chosenUnit;
						}
						Object.assign( measurement, parsed ); measurement.raw_value = raw;
						measurement.source = supplierMeasurementEquals( measurement, parsed ) ? 'aliexpress' : 'manual'; measurement.manual_updated_at = measurement.source === 'manual' ? new Date().toISOString() : '';
					}
					renderVariantGroups(); updateValidation();
				} );
				td.appendChild( cell ); tr.appendChild( td );
			}
			body.appendChild( tr );
		}
		table.appendChild( body ); wrap.appendChild( table ); details.appendChild( wrap );
		const toolbar = document.createElement( 'div' ); toolbar.className = 'size-guide-toolbar';
		const hint = document.createElement( 'span' ); hint.className = 'size-guide-hint'; hint.textContent = 'Valeur simple ou plage acceptée (ex. 94 ou 160–166). Les unités sont propres à chaque mesure.'; toolbar.appendChild( hint );
		const toggle = document.createElement( 'label' ); toggle.className = 'include-toggle'; const input = document.createElement( 'input' ); input.type = 'checkbox'; input.checked = state.sizeGuideInclude !== false; const track = document.createElement( 'span' ); track.className = 'switch-track'; const text = document.createElement( 'span' ); text.textContent = 'Inclure avec le produit'; toggle.append( input, track, text ); input.addEventListener( 'change', () => { state.sizeGuideInclude = input.checked; updateValidation(); } ); toolbar.appendChild( toggle ); details.appendChild( toolbar );
		return details;
	}

	function convertSingleValueGroupToCharacteristic( group, gIdx ) {
		if ( ! group || ! Array.isArray( group.options ) || group.options.length !== 1 ) return;
		const opt = group.options[0];
		state.characteristics.push( { id: `converted-${ Date.now() }`, selected: true, name: targetAttributeName( group ) || group.sourceAttribute || group.attribute || '', value: targetOptionValue( opt ), source_label: group.sourceAttribute || group.attribute || '', source_value: opt.value || '' } );
		state.variantGroups.splice( gIdx, 1 );
		renderCharacteristics(); renderVariantGroups(); renderPricing(); updateValidation();
	}

	function renderVariantGroups() {
		const interactionState = captureVariantInteractionState();
		const hadRenderedGroups = snapshotVariantAccordionState();
		els.variantGroups.innerHTML = '';
		const hasAny = state.variantGroups.some( ( g ) => ( g.options || [] ).length );
		els.variantsEmpty.hidden = hasAny;
		const supplierDimensionCount = Array.isArray( state.supplierVariantDimensions ) ? state.supplierVariantDimensions.length : 0;
		const matrixState = supplierDimensionCount > 1 ? stateMatrixCoverage( state, mappedSupplierVariations( state ) ) : null;
		state.variantGroups.forEach( ( group, gIdx ) => {
			const sourceName = String( group.sourceAttribute || group.attribute || '' ).trim();
			const targetName = targetAttributeName( group );
			const groupKey = variantGroupUiKey( group, gIdx );
			const details = document.createElement( 'details' );
			details.className = 'variant-group' + ( sourceName && targetName ? '' : ' is-error' );
			details.dataset.groupKey = groupKey;
			const defaultOpen = ! sourceName || ! targetName || gIdx === 0;
			details.open = ( variantUiInitialized || hadRenderedGroups ) ? openVariantGroupKeys.has( groupKey ) : defaultOpen;
			if ( details.open ) openVariantGroupKeys.add( groupKey );
			details.addEventListener( 'toggle', () => { if ( details.open ) openVariantGroupKeys.add( groupKey ); else openVariantGroupKeys.delete( groupKey ); } );
			const summary = document.createElement( 'summary' ); summary.className = 'variant-group-summary';
			const title = document.createElement( 'span' ); title.className = 'variant-group-title'; title.textContent = sourceName || 'Nom d’attribut requis';
			const mappedLabel = document.createElement( 'span' ); mappedLabel.className = 'variant-mapped-label'; mappedLabel.textContent = targetName ? `→ ${ targetName }` : '';
			const unavailableCount = supplierDimensionCount > 1 && matrixState && matrixState.complete ? ( group.options || [] ).filter( ( opt ) => ! supplierOptionUsedByRealSku( group, opt ) ).length : 0;
			const count = document.createElement( 'span' ); count.className = 'variant-count'; count.textContent = `${ ( group.options || [] ).length } valeur${ ( group.options || [] ).length > 1 ? 's' : '' }${ unavailableCount ? ` · ${ unavailableCount } indisponible${ unavailableCount > 1 ? 's' : '' }` : '' }`;
			const summaryStatus = document.createElement( 'span' ); summaryStatus.className = 'variant-summary-status' + ( group.wooTargetType === 'global' ? ' is-global' : group.wooTargetType === 'create_global' ? ' is-warning' : '' ); summaryStatus.textContent = group.wooTargetType === 'global' ? 'Global' : group.wooTargetType === 'create_global' ? 'À créer' : 'Produit';
			summary.append( title, mappedLabel, count, summaryStatus ); details.appendChild( summary );
			const body = document.createElement( 'div' ); body.className = 'variant-body';

			const mapRow = document.createElement( 'div' ); mapRow.className = 'variant-mapping-row';
			const sourceField = document.createElement( 'div' ); sourceField.className = 'variant-map-field'; sourceField.innerHTML = '<span>AliExpress</span>';
			let sourceInput;
			if ( sourceName ) { sourceInput = document.createElement( 'div' ); sourceInput.className = 'variant-source-readonly'; sourceInput.textContent = sourceName; sourceInput.dataset.value = sourceName; } else { sourceInput = document.createElement( 'input' ); sourceInput.type = 'text'; sourceInput.dataset.focusRole = 'source-attribute'; sourceInput.value = sourceName; sourceInput.placeholder = 'Nom de l’attribut source'; }
			sourceField.appendChild( sourceInput );
			const arrow = document.createElement( 'span' ); arrow.className = 'variant-map-arrow'; arrow.textContent = '→';
			const targetField = document.createElement( 'label' ); targetField.className = 'variant-map-field'; targetField.innerHTML = '<span>WooCommerce</span>';
			const targetSelect = document.createElement( 'select' ); targetSelect.className = 'variant-target-select'; targetSelect.dataset.focusRole = 'target-select';
			const productOpt = document.createElement( 'option' ); productOpt.value = 'product'; productOpt.textContent = 'Attribut propre au produit'; targetSelect.appendChild( productOpt );
			catalogAttributes().forEach( ( attrDef ) => { const opt = document.createElement( 'option' ); opt.value = `global:${ attrDef.id }`; opt.textContent = attrDef.name; targetSelect.appendChild( opt ); } );
			const createOpt = document.createElement( 'option' ); createOpt.value = 'create_global'; createOpt.textContent = '+ Créer un attribut global'; targetSelect.appendChild( createOpt );
			if ( group.wooTargetType === 'global' && group.wooAttributeId ) targetSelect.value = `global:${ group.wooAttributeId }`; else targetSelect.value = group.wooTargetType === 'create_global' ? 'create_global' : 'product';
			targetField.appendChild( targetSelect );
			const targetNameInput = document.createElement( 'input' ); targetNameInput.type = 'text'; targetNameInput.className = 'variant-target-name'; targetNameInput.dataset.focusRole = 'target-name'; targetNameInput.placeholder = 'Nom WooCommerce'; targetNameInput.value = targetName || sourceName; targetField.appendChild( targetNameInput );
			const mappingStatus = document.createElement( 'span' ); mappingStatus.className = 'mapping-status variant-mapping-status'; mappingStatus.setAttribute( 'aria-live', 'polite' ); targetField.appendChild( mappingStatus );
			mapRow.append( sourceField, arrow, targetField );

			const more = document.createElement( 'details' ); more.className = 'variant-more'; const moreSummary = document.createElement( 'summary' ); moreSummary.textContent = '⋯'; moreSummary.title = 'Actions de l’attribut'; const moreMenu = document.createElement( 'div' ); moreMenu.className = 'variant-more-menu'; const resetMap = document.createElement( 'button' ); resetMap.type = 'button'; resetMap.textContent = 'Réinitialiser le mapping'; resetMap.addEventListener( 'click', () => { group.wooTargetType = 'product'; group.wooAttributeId = 0; group.wooTaxonomy = ''; group.wooAttributeName = sourceName; more.open = false; renderVariantGroups(); updateValidation(); } ); const removeGroup = document.createElement( 'button' ); removeGroup.type = 'button'; removeGroup.className = 'danger'; removeGroup.textContent = 'Supprimer l’attribut'; removeGroup.addEventListener( 'click', () => { state.variantGroups.splice( gIdx, 1 ); renderVariantGroups(); renderPricing(); updateValidation(); } ); moreMenu.append( resetMap, removeGroup ); more.append( moreSummary, moreMenu );
			const mapWrap = document.createElement( 'div' ); mapWrap.className = 'variant-mapping-wrap'; mapWrap.append( mapRow, more ); body.appendChild( mapWrap );

			function syncTargetUi() {
				const selected = targetSelect.value;
				if ( selected.startsWith( 'global:' ) ) {
					const def = catalogAttributeById( Number( selected.split( ':' )[1] ) );
					group.wooTargetType = 'global'; group.wooAttributeId = def ? Number( def.id ) : 0; group.wooTaxonomy = def ? String( def.taxonomy || '' ) : ''; group.wooAttributeName = def ? String( def.name || sourceName ) : sourceName;
					targetNameInput.value = group.wooAttributeName; targetNameInput.hidden = true;
				} else {
					group.wooTargetType = selected === 'create_global' ? 'create_global' : 'product'; group.wooAttributeId = 0; group.wooTaxonomy = '';
					targetNameInput.hidden = false; if ( ! targetNameInput.value.trim() ) targetNameInput.value = sourceName; group.wooAttributeName = targetNameInput.value.trim();
				}
				mappedLabel.textContent = targetAttributeName( group ) && targetAttributeName( group ) !== sourceName ? `→ ${ targetAttributeName( group ) }` : '';
				mappingStatus.textContent = group.wooTargetType === 'global' ? 'Attribut global WooCommerce' : group.wooTargetType === 'create_global' ? 'Sera créé comme attribut global' : 'Attribut propre à ce produit';
				summaryStatus.className = 'variant-summary-status' + ( group.wooTargetType === 'global' ? ' is-global' : group.wooTargetType === 'create_global' ? ' is-warning' : '' ); summaryStatus.textContent = group.wooTargetType === 'global' ? 'Global' : group.wooTargetType === 'create_global' ? 'À créer' : 'Produit';
			}
			if ( ! sourceName && sourceInput instanceof HTMLInputElement ) {
				sourceInput.addEventListener( 'input', () => { const old = String( group.sourceAttribute || group.attribute || '' ); group.sourceAttribute = sourceInput.value; group.attribute = sourceInput.value; if ( group.wooTargetType !== 'global' && ( ! group.wooAttributeName || group.wooAttributeName === old ) ) { group.wooAttributeName = sourceInput.value; targetNameInput.value = sourceInput.value; } title.textContent = sourceInput.value.trim() || 'Nom d’attribut requis'; details.classList.toggle( 'is-error', ! sourceInput.value.trim() || ! targetAttributeName( group ) ); updateValidation(); } );
				sourceInput.addEventListener( 'change', () => { persistGroupMapping( group ); renderPricing(); updateValidation(); } );
			}
			targetSelect.addEventListener( 'change', () => { syncTargetUi(); persistGroupMapping( group ); renderVariantGroups(); renderPricing(); updateValidation(); } );
			targetNameInput.addEventListener( 'input', () => { group.wooAttributeName = targetNameInput.value; mappedLabel.textContent = targetNameInput.value.trim() && targetNameInput.value.trim() !== sourceName ? `→ ${ targetNameInput.value.trim() }` : ''; details.classList.toggle( 'is-error', ! String( group.sourceAttribute || group.attribute || '' ).trim() || ! targetNameInput.value.trim() ); updateValidation(); } );
			targetNameInput.addEventListener( 'change', () => { persistGroupMapping( group ); renderPricing(); updateValidation(); } );
			syncTargetUi();

			if ( ( group.options || [] ).length === 1 ) {
				const note = document.createElement( 'div' ); note.className = 'single-value-note'; const noteText = document.createElement( 'span' ); noteText.textContent = 'Une seule valeur : cet attribut ne crée aucune variation réelle.'; const noteActions = document.createElement( 'div' ); noteActions.className = 'single-value-note-actions'; const convert = document.createElement( 'button' ); convert.type = 'button'; convert.textContent = 'Convertir en caractéristique'; convert.addEventListener( 'click', () => convertSingleValueGroupToCharacteristic( group, gIdx ) ); const keep = document.createElement( 'button' ); keep.type = 'button'; keep.textContent = 'Conserver'; keep.addEventListener( 'click', () => { note.hidden = true; } ); noteActions.append( convert, keep ); note.append( noteText, noteActions ); body.appendChild( note );
			}
			const sizeGuideBlock = renderSizeGuideForGroup( group ); if ( sizeGuideBlock ) body.appendChild( sizeGuideBlock );
			const optionsWrap = document.createElement( 'div' ); optionsWrap.className = 'variant-options variant-option-cards';
			const selectedCatalog = group.wooTargetType === 'global' ? catalogAttributeById( group.wooAttributeId ) : null;
			let datalistId = '';
			if ( selectedCatalog && Array.isArray( selectedCatalog.terms ) && selectedCatalog.terms.length ) {
				datalistId = `variant-terms-${ gIdx }`; const dl = document.createElement( 'datalist' ); dl.id = datalistId; selectedCatalog.terms.forEach( ( term ) => { const op = document.createElement( 'option' ); op.value = term.name; dl.appendChild( op ); } ); body.appendChild( dl );
			}
			( group.options || [] ).forEach( ( opt, oIdx ) => {
				if ( opt.wooValue == null ) opt.wooValue = opt.value || '';
				if ( opt.originalImageUrl === undefined ) opt.originalImageUrl = opt.imageUrl || null;
				const unavailableSupplier = supplierDimensionCount > 1 && matrixState && matrixState.complete && ! supplierOptionUsedByRealSku( group, opt ); if ( unavailableSupplier && opt.importEnabled === undefined ) opt.importEnabled = false; if ( opt.importEnabled === undefined ) opt.importEnabled = true;
				const card = document.createElement( 'div' ); card.className = 'variant-value-card' + ( opt.imageUrl ? ' has-image' : '' ) + ( opt.importEnabled === false ? ' is-excluded' : '' );
				if ( opt.imageUrl ) {
					const imageWrap = document.createElement( 'div' ); imageWrap.className = 'variant-value-image-wrap';
					const imageBtn = document.createElement( 'button' ); imageBtn.type = 'button'; imageBtn.className = 'variant-value-image'; imageBtn.title = 'Modifier cette image'; imageBtn.setAttribute( 'aria-label', `Modifier l’image de ${ opt.value || 'la variante' }` );
					const img = document.createElement( 'img' ); img.src = opt.imageUrl; img.alt = opt.value || ''; imageBtn.appendChild( img );
					const pencil = document.createElement( 'span' ); pencil.className = 'variant-image-edit-badge'; pencil.textContent = '✎'; imageBtn.appendChild( pencil );
					imageBtn.addEventListener( 'click', () => document.dispatchEvent( new CustomEvent( 'cdh:edit-external-image', { detail: { targetId: `variant:${ gIdx }:${ oIdx }`, url: opt.imageUrl } } ) ) );
					imageWrap.appendChild( imageBtn );
					const imageMenu = document.createElement( 'details' ); imageMenu.className = 'variant-image-menu'; const imageMenuSummary = document.createElement( 'summary' ); imageMenuSummary.textContent = '⋯'; const imageMenuPanel = document.createElement( 'div' ); imageMenuPanel.className = 'variant-image-menu-panel'; const editImage = document.createElement( 'button' ); editImage.type = 'button'; editImage.textContent = 'Modifier dans Studio Image'; editImage.addEventListener( 'click', () => { imageMenu.open = false; document.dispatchEvent( new CustomEvent( 'cdh:edit-external-image', { detail: { targetId: `variant:${ gIdx }:${ oIdx }`, url: opt.imageUrl } } ) ); } ); imageMenuPanel.appendChild( editImage ); if ( opt.originalImageUrl ) { const restore = document.createElement( 'button' ); restore.type = 'button'; restore.textContent = 'Restaurer l’original'; restore.addEventListener( 'click', () => { opt.imageUrl = opt.originalImageUrl || null; opt.imageModified = false; opt.imageMediaId = null; imageMenu.open = false; renderVariantGroups(); } ); imageMenuPanel.appendChild( restore ); } const clear = document.createElement( 'button' ); clear.type = 'button'; clear.className = 'danger'; clear.textContent = 'Supprimer l’image'; clear.addEventListener( 'click', () => { opt.imageUrl = null; opt.imageMediaId = null; imageMenu.open = false; renderVariantGroups(); } ); imageMenuPanel.appendChild( clear ); imageMenu.append( imageMenuSummary, imageMenuPanel ); imageWrap.appendChild( imageMenu );
					card.appendChild( imageWrap );
				}
				const valueBody = document.createElement( 'div' ); valueBody.className = 'variant-value-body';
				const sourceWrap = document.createElement( 'div' ); sourceWrap.className = 'variant-source-badges';
				const sourceValue = document.createElement( 'span' ); sourceValue.className = 'variant-source-value'; sourceValue.textContent = opt.value || 'Valeur AliExpress'; sourceWrap.appendChild( sourceValue );
				if ( supplierDimensionCount > 1 && ! supplierOptionUsedByRealSku( group, opt ) ) {
					const sourceState = document.createElement( 'span' ); sourceState.className = 'variant-source-status ' + ( matrixState && matrixState.complete ? 'is-unavailable' : 'is-unresolved' ); sourceState.textContent = matrixState && matrixState.complete ? 'Indisponible fournisseur' : 'Non résolu'; sourceWrap.appendChild( sourceState );
				}
				valueBody.appendChild( sourceWrap );
				const valueArrow = document.createElement( 'span' ); valueArrow.className = 'variant-value-arrow'; valueArrow.textContent = '→'; valueBody.appendChild( valueArrow );
				const targetValue = document.createElement( 'input' ); targetValue.type = 'text'; targetValue.className = 'variant-target-value'; targetValue.dataset.focusRole = 'target-value'; targetValue.dataset.optionIndex = String( oIdx ); targetValue.value = opt.wooValue || opt.value || ''; targetValue.placeholder = 'Valeur WooCommerce'; targetValue.disabled = opt.importEnabled === false; if ( datalistId ) targetValue.setAttribute( 'list', datalistId );
				targetValue.addEventListener( 'input', () => { opt.wooValue = targetValue.value; updateValidation(); } ); targetValue.addEventListener( 'change', () => { persistGroupMapping( group ); renderPricing(); updateValidation(); } ); valueBody.appendChild( targetValue ); card.appendChild( valueBody );
				const optionMenu = document.createElement( 'details' ); optionMenu.className = 'variant-option-menu'; const optionSummary = document.createElement( 'summary' ); optionSummary.textContent = '⋯'; optionSummary.title = 'Actions de la valeur'; const optionPanel = document.createElement( 'div' ); optionPanel.className = 'variant-option-menu-panel'; const toggleImport = document.createElement( 'button' ); toggleImport.type = 'button'; toggleImport.textContent = opt.importEnabled === false ? 'Inclure comme valeur WooCommerce' : 'Ne pas importer'; toggleImport.addEventListener( 'click', () => { opt.importEnabled = opt.importEnabled === false; optionMenu.open = false; renderVariantGroups(); renderPricing(); updateValidation(); } ); const remove = document.createElement( 'button' ); remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Supprimer la valeur'; remove.addEventListener( 'click', () => { group.options.splice( oIdx, 1 ); optionMenu.open = false; renderVariantGroups(); renderPricing(); updateValidation(); } ); optionPanel.append( toggleImport, remove ); optionMenu.append( optionSummary, optionPanel ); card.appendChild( optionMenu ); optionsWrap.appendChild( card );
			} );
			body.appendChild( optionsWrap );
			const add = document.createElement( 'button' ); add.type = 'button'; add.className = 'btn-add'; add.textContent = '+ Ajouter une valeur WooCommerce'; add.style.marginTop = '10px';
			add.addEventListener( 'click', () => { group.options.push( { value: '', wooValue: '', imageUrl: null, originalImageUrl: null, sourceValueId: '', importEnabled: true } ); details.open = true; renderVariantGroups(); renderPricing(); updateValidation(); } );
			body.appendChild( add ); details.appendChild( body ); els.variantGroups.appendChild( details );
		} );
		variantUiInitialized = true;
		restoreVariantInteractionState( interactionState );
	}



	function supplierStockSummary( items ) {
		const rows = Array.isArray( items ) ? items.filter( Boolean ) : [];
		const quantities = rows.filter( ( item ) => item.stock_qty != null && Number.isFinite( Number( item.stock_qty ) ) ).map( ( item ) => Number( item.stock_qty ) );
		const known = rows.filter( ( item ) => item.stock_qty != null || ( item.stock_status && item.stock_status !== 'unknown' ) || item.available != null );
		const out = rows.filter( ( item ) => item.stock_status === 'out_of_stock' || item.available === false || Number( item.stock_qty ) === 0 );
		const total = quantities.reduce( ( sum, qty ) => sum + qty, 0 );
		return {
			totalSkus: rows.length,
			knownCount: known.length,
			qtyCount: quantities.length,
			outOfStockCount: out.length,
			totalQty: quantities.length ? total : null,
			minQty: quantities.length ? Math.min( ...quantities ) : null,
			maxQty: quantities.length ? Math.max( ...quantities ) : null,
			allKnown: rows.length > 0 && known.length === rows.length,
			allQuantified: rows.length > 0 && quantities.length === rows.length,
		};
	}

	function supplierStockLabel( items, compact = false ) {
		const stats = supplierStockSummary( items );
		if ( ! stats.totalSkus ) return 'Non requis';
		if ( stats.knownCount === 0 ) return `Non détecté · ${ stats.totalSkus } SKU à résoudre`;
		if ( stats.totalSkus === 1 ) {
			const item = items[0] || {};
			if ( item.stock_qty != null ) {
				const qty = Number( item.stock_qty );
				if ( qty === 0 ) return '0 unité · Rupture';
				return `${ qty.toLocaleString( 'fr-CH' ) } unité${ qty > 1 ? 's' : '' }`;
			}
			if ( item.stock_status === 'out_of_stock' || item.available === false ) return 'Rupture · quantité non communiquée';
			if ( item.stock_status === 'in_stock' || item.available === true ) return 'Disponible · quantité non communiquée';
			return 'Stock observé · quantité inconnue';
		}
		if ( stats.allQuantified ) {
			const total = stats.totalQty == null ? '' : ` · ${ stats.totalQty.toLocaleString( 'fr-CH' ) } unités`;
			return compact
				? `${ stats.qtyCount }/${ stats.totalSkus } quantifiés${ total }`
				: `${ stats.qtyCount }/${ stats.totalSkus } SKU quantifiés${ total } · ${ stats.outOfStockCount } rupture${ stats.outOfStockCount > 1 ? 's' : '' }`;
		}
		return `${ stats.knownCount }/${ stats.totalSkus } SKU observés${ stats.qtyCount ? ` · ${ stats.qtyCount } quantifiés` : '' }`;
	}

	function supplierSkuVariantLabel( item ) {
		const attrs = Array.isArray( item && item.attributes ) ? item.attributes : [];
		const values = attrs.map( ( attr ) => String( attr && attr.value || '' ).trim() ).filter( Boolean );
		if ( values.length ) return values.join( ' · ' );
		return item && item.supplier_sku_id ? `SKU ${ String( item.supplier_sku_id ).slice( -12 ) }` : 'Produit simple';
	}

	function renderSupplierStockDetails( items ) {
		const rows = Array.isArray( items ) ? items : [];
		if ( ! rows.length ) return '';
		const commonObservation = commonSupplierObservation( rows );
		const body = rows.map( ( item ) => {
			const price = item && item.supplier_price ? Number( item.supplier_price.amount || 0 ) : 0;
			const currency = item && item.supplier_price ? String( item.supplier_price.currency || '' ).toUpperCase() : '';
			let stock = 'Inconnu';
			let statusClass = 'is-unknown';
			if ( item && item.stock_qty != null ) {
				const qty = Number( item.stock_qty );
				stock = qty === 0 ? '0 · Rupture' : `${ qty.toLocaleString( 'fr-CH' ) } unité${ qty > 1 ? 's' : '' }`;
				statusClass = qty === 0 ? 'is-out' : 'is-ok';
			} else if ( item && ( item.stock_status === 'out_of_stock' || item.available === false ) ) { stock = 'Rupture · quantité inconnue'; statusClass = 'is-out'; }
			else if ( item && ( item.stock_status === 'in_stock' || item.available === true ) ) { stock = 'Disponible · quantité inconnue'; statusClass = 'is-ok'; }
			const observationCell = commonObservation ? '' : `<td>${ esc( formatSupplierObservation( item && item.observed_at ) ) }</td>`;
			return `<tr><td>${ esc( supplierSkuVariantLabel( item ) ) }<small>${ esc( item && item.supplier_sku_id || '—' ) }</small></td><td>${ esc( currency ) } ${ price ? price.toLocaleString( 'fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) : '—' }</td><td><span class="supplier-stock-value ${ statusClass }">${ esc( stock ) }</span></td>${ observationCell }</tr>`;
		} ).join( '' );
		const commonMeta = commonObservation ? `<small>Dernier relevé : ${ esc( formatSupplierObservation( commonObservation ).replace( ' · ', ' à ' ).toLowerCase() ) }</small>` : '';
		const observationHeading = commonObservation ? '' : '<th>Observation</th>';
		return `<details class="supplier-stock-details"><summary><span class="supplier-stock-title">Voir le stock par SKU${ commonMeta }</span><span class="supplier-stock-count">${ rows.length } SKU</span></summary><div class="supplier-stock-table-wrap"><table class="supplier-stock-table"><thead><tr><th>Variante / SKU fournisseur</th><th>Prix fournisseur</th><th>Stock fournisseur</th>${ observationHeading }</tr></thead><tbody>${ body }</tbody></table></div></details>`;
	}

	function renderPricing() {
		if ( ! state || ! els.pricingPreview ) return;
		const groups = validPricingGroups( state.variantGroups );
		const mapped = mappedSupplierVariations( state );
		const skuCount = mapped.variations.length;
		const stockStats = supplierStockSummary( mapped.variations );
		const stockQtyCount = stockStats.qtyCount;
		const stockKnownCount = stockStats.knownCount;
		const outOfStockCount = stockStats.outOfStockCount;
		const optionCount = groups.reduce( ( sum, group ) => sum + group.options.length, 0 );
		const theoreticalCount = groups.length ? groups.reduce( ( total, group ) => total * Math.max( 1, group.options.length ), 1 ) : 0;
		const pricingConfig = shopConfig && shopConfig.pricing ? shopConfig.pricing : null;
		const matrix = stateMatrixCoverage( state, mapped );
		const verified = ! mapped.ambiguous && matrix.complete && ( ! groups.length || ( skuCount > 0 && mapped.variations.every( ( item ) => item.supplier_sku_id && item.supplier_price && Number( item.supplier_price.amount ) > 0 ) ) );
		const shippingStats = supplierShippingSummary( state.shippingCurrent, state.priceAmount, mapped.variations );
		const shippingObservation = supplierVerificationLabel( state.shippingCurrent && state.shippingCurrent.observed_at );
		const shippingRowHtml = extractionEnabled( 'shipping', true ) ? `<div class="pricing-compact-row"><span>Livraison fournisseur</span><strong>${ esc( shippingUiLabel( state.shippingCurrent, state.priceAmount, mapped.variations ) ) }${ shippingObservation ? `<small class="pricing-observation">${ esc( shippingObservation ) }</small>` : '' }</strong></div>` : '';
		const landedRowHtml = extractionEnabled( 'shipping', true ) && shippingStats.landedCost != null ? `<div class="pricing-compact-row pricing-landed-cost"><span>Coût total fournisseur (réf.)</span><strong>${ esc( ( shippingStats.currency || state.priceCurrency || '' ) + ' ' + Number( shippingStats.landedCost ).toLocaleString( 'fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) ) }</strong></div>` : '';
		if ( els.pricingCount ) els.pricingCount.textContent = ! groups.length ? 'Produit simple' : matrix.exact && matrix.expectedSkus != null ? `${ matrix.verifiedSkus }/${ matrix.expectedSkus } SKU vérifiés` : matrix.complete ? `${ skuCount } SKU réels` : `${ matrix.mappedSkus }/${ matrix.verifiedSkus || skuCount } SKU mappés`;

		if ( els.pricingSourceState ) {
			const stockIncomplete = skuCount > 0 && stockKnownCount < skuCount;
			els.pricingSourceState.hidden = ( verified && ! stockIncomplete ) || ! groups.length;
			if ( ( ! verified || stockIncomplete ) && groups.length ) {
				const diag = state.supplierSkuDiagnostics || {};
				els.pricingSourceState.className = 'pricing-source-state warn';
				els.pricingSourceState.innerHTML = '';
				const message = document.createElement( 'div' );
				message.textContent = ! matrix.complete
					? `Matrice SKU incomplète · ${ matrix.exact && matrix.expectedSkus != null ? `${ matrix.verifiedSkus }/${ matrix.expectedSkus } SKU vérifiés` : `${ matrix.mappedSkus }/${ matrix.verifiedSkus || skuCount } SKU réels avec chemin complet` }. Constello bloque l’import plutôt que d’inventer des variantes.`
					: ! verified
						? `${ groups.length } dimensions · ${ optionCount } valeurs détectées. Les SKU/prix fournisseur réels ne sont pas encore vérifiés ; aucune combinaison théorique ne sera créée.`
					: stockKnownCount === 0
						? `Stock fournisseur non détecté dans le payload initial · ${ skuCount } SKU à résoudre.`
						: `Stock fournisseur partiel · ${ stockKnownCount }/${ skuCount } SKU observés.`;
				els.pricingSourceState.appendChild( message );
				const details = document.createElement( 'details' ); details.style.marginTop = '8px';
				const summary = document.createElement( 'summary' ); summary.textContent = 'Diagnostic technique'; details.appendChild( summary );
				const diagnosticLines = [];
				if ( diag.network_observer_installed ) diagnosticLines.push( 'Observation réseau passive : active' );
				if ( diag.network_requests_observed != null ) diagnosticLines.push( `Requêtes AliExpress observées : ${ diag.network_requests_observed }` );
				if ( diag.network_fetch_responses != null ) diagnosticLines.push( `Réponses fetch : ${ diag.network_fetch_responses }` );
				if ( diag.network_xhr_responses != null ) diagnosticLines.push( `Réponses XHR : ${ diag.network_xhr_responses }` );
				if ( diag.network_jsonp_payloads != null ) diagnosticLines.push( `Payloads JSONP : ${ diag.network_jsonp_payloads }` );
				if ( diag.network_json_inspected != null ) diagnosticLines.push( `Réponses JSON inspectées : ${ diag.network_json_inspected }` );
				if ( diag.network_sku_candidates != null ) diagnosticLines.push( `Réponses SKU candidates : ${ diag.network_sku_candidates }` );
				if ( diag.network_description_candidates != null ) diagnosticLines.push( `Réponses description candidates : ${ diag.network_description_candidates }` );
				if ( diag.network_modern_price_rows ) diagnosticLines.push( `Prix SKU réseau repérés : ${ diag.network_modern_price_rows }` );
				if ( diag.network_mapping_rows ) diagnosticLines.push( `Mappings SKU ↔ options repérés : ${ diag.network_mapping_rows }` );
				if ( diag.network_inventory_candidates != null ) diagnosticLines.push( `Payloads inventaire candidats : ${ diag.network_inventory_candidates }` );
				if ( diag.network_stock_only_rows != null ) diagnosticLines.push( `Lignes stock seules repérées : ${ diag.network_stock_only_rows }` );
				if ( diag.stock_resolver_runs != null ) diagnosticLines.push( `Résolution active stock : ${ diag.stock_resolver_runs ? 'exécutée' : 'non exécutée' }` );
				if ( diag.stock_resolver_attempted_skus != null ) diagnosticLines.push( `SKU testés par le résolveur : ${ diag.stock_resolver_attempted_skus }` );
				if ( diag.stock_resolver_resolved_skus != null ) diagnosticLines.push( `SKU résolus par le résolveur : ${ diag.stock_resolver_resolved_skus }` );
				if ( diag.stock_resolver_clicks != null ) diagnosticLines.push( `Sélections de variantes effectuées : ${ diag.stock_resolver_clicks }` );
				if ( diag.stock_resolver_timeouts != null && diag.stock_resolver_timeouts ) diagnosticLines.push( `Timeouts du résolveur : ${ diag.stock_resolver_timeouts }` );
				if ( diag.stock_resolver_last_error ) diagnosticLines.push( `Erreur résolveur : ${ diag.stock_resolver_last_error }` );
				if ( diag.matrix_complete != null ) diagnosticLines.push( `Matrice SKU : ${ diag.matrix_complete ? 'complète' : 'incomplète' }` );
				if ( diag.matrix_expected_skus != null ) diagnosticLines.push( `SKU attendus (1 dimension) : ${ diag.matrix_expected_skus }` );
				if ( diag.matrix_verified_skus != null ) diagnosticLines.push( `SKU réels tarifés détectés : ${ diag.matrix_verified_skus }` );
				if ( diag.matrix_mapped_skus != null ) diagnosticLines.push( `SKU avec chemin d’attributs complet : ${ diag.matrix_mapped_skus }` );
				if ( diag.matrix_unmapped_sku_count != null && diag.matrix_unmapped_sku_count ) diagnosticLines.push( `SKU réels sans chemin complet : ${ diag.matrix_unmapped_sku_count }` );
				if ( Array.isArray( diag.matrix_unmapped_sku_ids ) && diag.matrix_unmapped_sku_ids.length ) diagnosticLines.push( `SKU à rattacher : ${ diag.matrix_unmapped_sku_ids.join( ' · ' ) }` );
				if ( diag.matrix_unused_value_count != null && diag.matrix_unused_value_count ) diagnosticLines.push( `Valeurs AliExpress sans SKU réel observé : ${ diag.matrix_unused_value_count }` );
				if ( Array.isArray( diag.matrix_unused_values ) && diag.matrix_unused_values.length ) diagnosticLines.push( `Valeurs potentiellement indisponibles : ${ diag.matrix_unused_values.join( ' · ' ) }` );
				if ( diag.matrix_missing_value_count != null && diag.matrix_missing_value_count ) diagnosticLines.push( `Valeurs sans SKU associé (1 dimension) : ${ diag.matrix_missing_value_count }` );
				if ( Array.isArray( diag.matrix_missing_values ) && diag.matrix_missing_values.length ) diagnosticLines.push( `Valeurs à résoudre : ${ diag.matrix_missing_values.join( ' · ' ) }` );
				if ( diag.matrix_resolver_runs != null ) diagnosticLines.push( `Résolution active matrice : ${ diag.matrix_resolver_runs ? 'exécutée' : 'non exécutée' }` );
				if ( diag.matrix_resolver_attempted_values != null ) diagnosticLines.push( `Valeurs testées par le résolveur matrice : ${ diag.matrix_resolver_attempted_values }` );
				if ( diag.matrix_resolver_resolved_values != null ) diagnosticLines.push( `Valeurs résolues par le résolveur matrice : ${ diag.matrix_resolver_resolved_values }` );
				if ( diag.matrix_resolver_clicks != null ) diagnosticLines.push( `Sélections effectuées par le résolveur matrice : ${ diag.matrix_resolver_clicks }` );
				if ( diag.matrix_resolver_last_error ) diagnosticLines.push( `Erreur résolveur matrice : ${ diag.matrix_resolver_last_error }` );
				if ( diag.matrix_adjust_responses != null ) diagnosticLines.push( `Réponses pdp.pc.adjust capturées : ${ diag.matrix_adjust_responses }` );
				if ( diag.matrix_adjust_candidate_rows != null ) diagnosticLines.push( `Candidats SKU dans pdp.pc.adjust : ${ diag.matrix_adjust_candidate_rows }` );
				if ( diag.matrix_adjust_sku_path_rows != null ) diagnosticLines.push( `SKU repérés dans skuPaths : ${ diag.matrix_adjust_sku_path_rows }` );
				if ( diag.matrix_adjust_full_path_rows != null ) diagnosticLines.push( `SKU pdp.adjust avec chemin complet : ${ diag.matrix_adjust_full_path_rows }` );
				if ( diag.matrix_adjust_unmapped_rows != null && diag.matrix_adjust_unmapped_rows ) diagnosticLines.push( `SKU pdp.adjust sans chemin complet : ${ diag.matrix_adjust_unmapped_rows }` );
				if ( diag.matrix_adjust_context_matches != null ) diagnosticLines.push( `Rattachements contextuels pdp.pc.adjust : ${ diag.matrix_adjust_context_matches }` );
				if ( diag.matrix_adjust_inferred_rows != null ) diagnosticLines.push( `Rattachements 1D inférés après sélection : ${ diag.matrix_adjust_inferred_rows }` );
				if ( diag.matrix_adjust_last_url ) diagnosticLines.push( `Endpoint résolution matrice : ${ diag.matrix_adjust_last_url }` );
				if ( Array.isArray( diag.stock_source_paths ) && diag.stock_source_paths.length ) diagnosticLines.push( `Sources stock détectées : ${ diag.stock_source_paths.slice( 0, 4 ).join( ' · ' ) }` );
				if ( diag.stock_qty_rows != null ) diagnosticLines.push( `Stocks quantifiés par SKU : ${ diag.stock_qty_rows }` );
				if ( diag.stock_status_rows != null ) diagnosticLines.push( `Disponibilités SKU connues : ${ diag.stock_status_rows }` );
				if ( diag.modern_quantity_path ) diagnosticLines.push( `Source stock : ${ diag.modern_quantity_path }` );
				if ( Array.isArray( diag.network_candidate_urls ) && diag.network_candidate_urls.length ) diagnosticLines.push( `Sources réseau : ${ diag.network_candidate_urls.slice( -4 ).join( ' · ' ) }` );
				if ( diag.runtime_roots_checked != null ) diagnosticLines.push( `Sources runtime : ${ diag.runtime_roots_checked }` );
				if ( diag.scripts_scanned != null ) diagnosticLines.push( `Scripts inspectés : ${ diag.scripts_scanned }` );
				diagnosticLines.push( `Combinaisons théoriques ignorées : ${ theoreticalCount }` );
				const pre = document.createElement( 'div' ); pre.style.marginTop = '6px'; pre.style.whiteSpace = 'pre-line'; pre.textContent = diagnosticLines.join( '\n' ); details.appendChild( pre );
				els.pricingSourceState.appendChild( details );
			}
		}

		els.pricingPreview.innerHTML = '';
		const box = document.createElement( 'div' );
		box.className = verified ? 'pricing-compact' : 'pricing-empty';
		if ( ! pricingConfig || ! pricingConfig.configured ) {
			box.innerHTML = `${ shippingRowHtml }${ landedRowHtml }<strong>Tarification WordPress à configurer</strong><br>Configure une règle commerciale dans Constello Dropship Hub → Réglages → Tarification.`;
		} else if ( groups.length && ! verified ) {
			box.innerHTML = `${ shippingRowHtml }${ landedRowHtml }<strong>Import des variations suspendu</strong><br>Constello n’invente aucune combinaison tant que les SKU/prix fournisseur réels ne sont pas vérifiés.`;
		} else if ( ! groups.length ) {
			const simpleSkuRow = skuCount ? `<div class="pricing-compact-row"><span>SKU fournisseur</span><strong>${ skuCount } observé${ skuCount > 1 ? 's' : '' }</strong></div>` : '';
			const simpleStockRow = skuCount ? `<div class="pricing-compact-row"><span>Stock fournisseur</span><strong>${ esc( supplierStockLabel( mapped.variations ) ) }</strong></div>` : '';
			const simpleAvailability = skuCount === 1 && stockKnownCount ? `<div class="pricing-compact-row"><span>Disponibilité</span><strong>${ mapped.variations[0].stock_status === 'out_of_stock' || mapped.variations[0].available === false || Number( mapped.variations[0].stock_qty ) === 0 ? 'Rupture' : 'En stock' }</strong></div>` : '';
			const simpleObserved = skuCount === 1 && mapped.variations[0].observed_at ? `<div class="pricing-compact-row"><span>Dernière observation</span><strong>${ esc( formatSupplierObservation( mapped.variations[0].observed_at ) ) }</strong></div>` : '';
			box.innerHTML = `${ simpleSkuRow }${ simpleStockRow }${ simpleAvailability }${ simpleObserved }${ shippingRowHtml }${ landedRowHtml }<div class="pricing-compact-row"><span>Règle active</span><strong>${ esc( pricingConfig.name || 'Règle par défaut' ) } · v${ Number( pricingConfig.version || 0 ) }</strong></div>${ renderSupplierStockDetails( mapped.variations ) }<p>Prix, stock et livraison fournisseur sont conservés séparément. La règle commerciale WordPress actuelle continue d’utiliser le prix fournisseur tant qu’une base de calcul incluant la livraison n’est pas explicitement activée.</p>`;
		} else {
			const stockLabel = supplierStockLabel( mapped.variations );
			const stockSummaryRows = stockStats.qtyCount ? `<div class="pricing-compact-row"><span>Stock total observé</span><strong>${ stockStats.totalQty.toLocaleString( 'fr-CH' ) } unités</strong></div><div class="pricing-compact-row"><span>Plage de stock</span><strong>${ stockStats.minQty.toLocaleString( 'fr-CH' ) } → ${ stockStats.maxQty.toLocaleString( 'fr-CH' ) } unités</strong></div>` : '';
			box.innerHTML = `<div class="pricing-compact-row"><span>Coûts fournisseur</span><strong>${ esc( supplierCostLabel( mapped.variations ) ) }</strong></div><div class="pricing-compact-row"><span>Stock fournisseur</span><strong>${ esc( stockLabel ) }</strong></div>${ stockSummaryRows }${ shippingRowHtml }${ landedRowHtml }<div class="pricing-compact-row"><span>Règle active</span><strong>${ esc( pricingConfig.name || 'Règle par défaut' ) } · v${ Number( pricingConfig.version || 0 ) }</strong></div>${ renderSupplierStockDetails( mapped.variations ) }<p>Prix, stock et livraison fournisseur sont historisables séparément. Le coût total affiché est une référence de la sélection courante ; la tarification WordPress n’est pas modifiée automatiquement.</p>`;
		}
		els.pricingPreview.appendChild( box );
	}

	function currentPayload() {
		return buildPayload( {
			...state,
			title: els.titleInput.value,
			priceAmount: els.priceInput.value,
			includeDescription: els.includeDescription.checked,
			descriptionHtml: sanitizeDescriptionForEditor( els.descriptionInput.value ),
		} );
	}

	function categoryById( id ) { return loadedCategories.find( ( item ) => String( item.id ) === String( id ) ) || null; }
	function categoryPath( item ) {
		if ( ! item ) return '';
		const names = []; const seen = new Set(); let current = item;
		while ( current && ! seen.has( String( current.id ) ) ) { seen.add( String( current.id ) ); names.unshift( String( current.name || '' ) ); current = current.parent ? categoryById( current.parent ) : null; }
		return names.filter( Boolean ).join( ' › ' );
	}
	function categoryDepth( item ) { const path = categoryPath( item ); return path ? Math.max( 0, path.split( ' › ' ).length - 1 ) : 0; }
	function categoryRecentKey() { const site = shopConfig && shopConfig.site_url ? String( shopConfig.site_url ) : 'default'; return `cdh_category_recents:${ site }`; }
	function readCategoryRecents() { try { const parsed = JSON.parse( localStorage.getItem( categoryRecentKey() ) || '[]' ); return Array.isArray( parsed ) ? parsed.map( String ).slice( 0, 5 ) : []; } catch ( e ) { return []; } }
	function rememberCategory( id ) { if ( ! id ) return; const next = [ String( id ), ...readCategoryRecents().filter( ( value ) => value !== String( id ) ) ].slice( 0, 5 ); try { localStorage.setItem( categoryRecentKey(), JSON.stringify( next ) ); } catch ( e ) {} }
	function orderedCategories() {
		const children = new Map(); loadedCategories.forEach( ( item ) => { const parent = String( item.parent || 0 ); if ( ! children.has( parent ) ) children.set( parent, [] ); children.get( parent ).push( item ); } );
		children.forEach( ( items ) => items.sort( ( a, b ) => String( a.name || '' ).localeCompare( String( b.name || '' ), 'fr', { sensitivity: 'base' } ) ) );
		const out = []; const walk = ( parent, depth ) => { ( children.get( String( parent ) ) || [] ).forEach( ( item ) => { out.push( { item, depth } ); walk( item.id, depth + 1 ); } ); }; walk( 0, 0 );
		// Orphan terms remain selectable instead of disappearing.
		const included = new Set( out.map( ( row ) => String( row.item.id ) ) ); loadedCategories.forEach( ( item ) => { if ( ! included.has( String( item.id ) ) ) out.push( { item, depth: categoryDepth( item ) } ); } );
		return out;
	}
	function selectCategory( id, remember = true ) {
		if ( ! state ) return;
		state.category_id = id ? Number( id ) : null;
		els.categorySelect.value = id ? String( id ) : '';
		const selected = categoryById( id );
		els.categoryCurrent.textContent = selected ? categoryPath( selected ) : '— Aucune catégorie —';
		els.categoryHint.textContent = selected ? `Chemin : ${ categoryPath( selected ) }` : 'Optionnelle · choisis une catégorie pour mieux structurer le produit.';
		if ( remember && id ) rememberCategory( id );
		if ( els.categoryPanel ) els.categoryPanel.hidden = true; if ( els.categoryTrigger ) els.categoryTrigger.setAttribute( 'aria-expanded', 'false' );
		renderCategoryOptions( els.categorySearch ? els.categorySearch.value : '' ); updateValidation();
	}
	function categoryOptionButton( item, depth = 0, showPath = false ) {
		const btn = document.createElement( 'button' ); btn.type = 'button'; btn.className = 'category-option' + ( state && String( state.category_id || '' ) === String( item.id ) ? ' is-selected' : '' ); btn.dataset.categoryId = String( item.id ); btn.style.paddingLeft = `${ 10 + Math.min( depth, 5 ) * 16 }px`;
		const label = document.createElement( 'span' ); label.textContent = item.name; btn.appendChild( label );
		if ( showPath ) { const path = document.createElement( 'span' ); path.className = 'category-path'; path.textContent = categoryPath( item ); btn.appendChild( path ); }
		btn.addEventListener( 'click', () => selectCategory( item.id ) ); return btn;
	}
	function renderCategoryOptions( search = '' ) {
		if ( ! els.categoryOptions ) return;
		const q = String( search || '' ).trim().toLocaleLowerCase( 'fr' ); els.categoryOptions.innerHTML = '';
		const none = document.createElement( 'button' ); none.type = 'button'; none.className = 'category-option' + ( ! state || ! state.category_id ? ' is-selected' : '' ); none.textContent = '— Aucune catégorie —'; none.addEventListener( 'click', () => selectCategory( null ) ); els.categoryOptions.appendChild( none );
		const rows = orderedCategories().filter( ( row ) => ! q || categoryPath( row.item ).toLocaleLowerCase( 'fr' ).includes( q ) || String( row.item.name || '' ).toLocaleLowerCase( 'fr' ).includes( q ) );
		if ( ! rows.length ) { const empty = document.createElement( 'div' ); empty.className = 'category-empty'; empty.textContent = 'Aucune catégorie correspondante.'; els.categoryOptions.appendChild( empty ); }
		rows.forEach( ( row ) => els.categoryOptions.appendChild( categoryOptionButton( row.item, q ? 0 : row.depth, !! q ) ) );
		const recentIds = readCategoryRecents(); els.categoryRecentList.innerHTML = ''; const recents = recentIds.map( categoryById ).filter( Boolean ); els.categoryRecents.hidden = ! recents.length || !! q; recents.forEach( ( item ) => els.categoryRecentList.appendChild( categoryOptionButton( item, 0, true ) ) );
	}

	async function loadCategoryOptions() {
		els.categorySelect.disabled = true; els.categorySelect.innerHTML = '<option value="">Chargement…</option>'; els.categoryHint.textContent = '';
		let response; try { response = await chrome.runtime.sendMessage( { type: 'CDH_GET_CATEGORIES' } ); } catch ( err ) { response = null; }
		if ( ! response || ! response.ok ) {
			loadedCategories = []; els.categorySelect.innerHTML = '<option value="">— Catégories indisponibles —</option>'; els.categorySelect.disabled = false;
			els.categoryCurrent.textContent = 'Catégories indisponibles'; els.categoryHint.textContent = response && response.code === 'missing_settings' ? 'Configure la connexion dans Réglages.' : 'Impossible de charger les catégories.'; renderCategoryOptions(); updateValidation(); return;
		}
		loadedCategories = ( response.categories || [] ).map( ( category ) => Object.assign( {}, category, { name: decodeHtmlEntities( category && category.name || '' ) } ) );
		const selected = state && state.category_id != null ? String( state.category_id ) : '';
		els.categorySelect.innerHTML = '<option value="">— Aucune —</option>' + loadedCategories.map( ( c ) => `<option value="${ esc( c.id ) }"${ String( c.id ) === selected ? ' selected' : '' }>${ esc( categoryPath( c ) || c.name ) }</option>` ).join( '' );
		els.categorySelect.disabled = false; renderCategoryOptions(); selectCategory( selected || null, false );
	}


	function sanitizeDescriptionForEditor( rawHtml ) {
		const raw = String( rawHtml || '' );
		if ( ! raw.trim() || typeof DOMParser === 'undefined' ) return raw;
		let doc;
		try { doc = new DOMParser().parseFromString( `<div id="cdh-root">${ raw }</div>`, 'text/html' ); } catch ( e ) { return ''; }
		const root = doc.getElementById( 'cdh-root' );
		if ( ! root ) return '';
		for ( const bad of Array.from( root.querySelectorAll( 'script,style,template,iframe,object,embed,form,input,button,textarea,select,meta,link,base' ) ) ) bad.remove();
		for ( const node of Array.from( root.querySelectorAll( '*' ) ) ) {
			const tag = String( node.tagName || '' ).toLowerCase();
			for ( const attr of Array.from( node.attributes || [] ) ) {
				const name = String( attr.name || '' ).toLowerCase();
				if ( tag === 'img' && ( name === 'src' || name === 'alt' ) ) continue;
				if ( tag === 'a' && name === 'href' ) continue;
				node.removeAttribute( attr.name );
			}
			if ( tag === 'img' ) {
				const src = normalizeEditorMediaUrl( node.getAttribute( 'src' ) || '' );
				if ( ! src || isLocalImage( src ) ) { node.remove(); continue; }
				node.setAttribute( 'src', src ); node.setAttribute( 'loading', 'lazy' );
				if ( ! node.getAttribute( 'alt' ) ) node.setAttribute( 'alt', '' );
			}
			if ( tag === 'a' ) {
				const href = String( node.getAttribute( 'href' ) || '' ).trim();
				if ( ! /^https:\/\//i.test( href ) ) node.removeAttribute( 'href' );
				else { node.setAttribute( 'target', '_blank' ); node.setAttribute( 'rel', 'noopener noreferrer nofollow' ); }
			}
		}
		return root.innerHTML;
	}

	function descriptionStats( html ) {
		const raw = String( html || '' );
		if ( ! raw.trim() || typeof DOMParser === 'undefined' ) return { chars: 0, images: 0 };
		try {
			const doc = new DOMParser().parseFromString( raw, 'text/html' );
			const text = String( doc.body && doc.body.textContent || '' ).replace( /\s+/g, ' ' ).trim();
			return { chars: text.length, images: doc.querySelectorAll( 'img[src]' ).length };
		} catch ( e ) { return { chars: raw.replace( /<[^>]+>/g, '' ).trim().length, images: ( raw.match( /<img\b/gi ) || [] ).length }; }
	}

	function humanDescriptionSource() {
		const diag = state && state.descriptionDiagnostics ? state.descriptionDiagnostics : {};
		const source = String( diag.source || diag.description_source || state && state.descriptionSource || '' ).toLowerCase();
		if ( source.includes( 'shadow' ) ) return 'Shadow DOM AliExpress';
		if ( source.includes( 'network' ) ) return 'Données AliExpress';
		if ( source.includes( 'iframe' ) ) return 'Description AliExpress';
		if ( source.includes( 'dom' ) ) return 'DOM AliExpress';
		return 'Contenu nettoyé par Constello';
	}

	function updateDescriptionMeta() {
		if ( ! els.descriptionMeta ) return;
		const html = String( els.descriptionInput.value || '' ).trim();
		const stats = descriptionStats( html );
		els.descriptionMeta.hidden = ! html;
		if ( els.descriptionCounts ) els.descriptionCounts.textContent = `${ stats.chars.toLocaleString( 'fr-CH' ) } caractères · ${ stats.images } image${ stats.images === 1 ? '' : 's' }`;
		if ( els.descriptionSourceChip ) { els.descriptionSourceChip.textContent = humanDescriptionSource(); els.descriptionSourceChip.classList.toggle( 'is-ok', !! html ); }
		if ( els.descriptionDiagnosticsGrid ) {
			const diag = state && state.descriptionDiagnostics ? state.descriptionDiagnostics : {};
			const rows = [
				[ 'État', html ? 'Détectée' : ( state && state.descriptionStatus || 'Non détectée' ) ],
				[ 'Source', humanDescriptionSource() ],
				[ 'Texte', `${ stats.chars.toLocaleString( 'fr-CH' ) } caractères` ],
				[ 'Images', String( stats.images ) ],
			];
			if ( diag.selector ) rows.push( [ 'Sélecteur', String( diag.selector ) ] );
			if ( diag.descriptionScore != null ) rows.push( [ 'Score', String( diag.descriptionScore ) ] );
			els.descriptionDiagnosticsGrid.innerHTML = rows.map( ( row ) => `<strong>${ esc( row[0] ) }</strong><span>${ esc( row[1] ) }</span>` ).join( '' );
		}
	}

	function renderDescriptionEditor() {
		if ( ! els.descriptionEditor ) return;
		const safe = sanitizeDescriptionForEditor( els.descriptionInput.value );
		if ( els.descriptionEditor.innerHTML !== safe ) els.descriptionEditor.innerHTML = safe;
		selectedDescriptionImage = null;
		if ( els.descriptionRemoveImage ) els.descriptionRemoveImage.disabled = true;
	}

	function syncDescriptionFromEditor() {
		if ( ! els.descriptionEditor ) return;
		const safe = sanitizeDescriptionForEditor( els.descriptionEditor.innerHTML );
		els.descriptionInput.value = safe;
		if ( state ) state.descriptionStatus = safe.trim() ? 'extracted' : 'not_found';
		updateValidation();
	}

	const DESCRIPTION_PANE_DEFAULTS = { preview: 520, edit: 600, html: 520 };
	function descriptionPaneStorageKey( name ) { return `cdh_description_pane_height_${ name }`; }
	function clampDescriptionPaneHeight( value ) {
		const min = window.innerWidth <= 760 ? 260 : 300;
		const max = Math.max( min, Math.floor( window.innerHeight * .80 ) );
		return Math.min( max, Math.max( min, Math.round( Number( value ) || min ) ) );
	}
	function setDescriptionPaneHeight( name, value, persist = true ) {
		const pane = document.querySelector( `[data-desc-resize="${ name }"]` );
		if ( ! pane || ( els.descriptionCard && els.descriptionCard.classList.contains( 'is-fullscreen' ) ) ) return;
		const height = clampDescriptionPaneHeight( value );
		pane.style.setProperty( '--desc-pane-height', `${ height }px` );
		if ( persist ) { try { localStorage.setItem( descriptionPaneStorageKey( name ), String( height ) ); } catch ( e ) {} }
	}
	function restoreDescriptionPaneHeights() {
		for ( const [ name, fallback ] of Object.entries( DESCRIPTION_PANE_DEFAULTS ) ) {
			let stored = fallback;
			try { stored = Number( localStorage.getItem( descriptionPaneStorageKey( name ) ) || fallback ); } catch ( e ) {}
			setDescriptionPaneHeight( name, stored, false );
		}
	}
	function bindDescriptionResizers() {
		document.querySelectorAll( '[data-desc-resize-handle]' ).forEach( ( handle ) => {
			handle.addEventListener( 'pointerdown', ( event ) => {
				if ( els.descriptionCard && els.descriptionCard.classList.contains( 'is-fullscreen' ) ) return;
				const name = handle.dataset.descResizeHandle;
				const pane = document.querySelector( `[data-desc-resize="${ name }"]` );
				if ( ! pane ) return;
				event.preventDefault();
				const startY = event.clientY;
				const startHeight = pane.getBoundingClientRect().height;
				handle.classList.add( 'is-dragging' );
				try { handle.setPointerCapture( event.pointerId ); } catch ( e ) {}
				const move = ( e ) => setDescriptionPaneHeight( name, startHeight + ( e.clientY - startY ), false );
				const up = ( e ) => {
					handle.classList.remove( 'is-dragging' );
					handle.removeEventListener( 'pointermove', move ); handle.removeEventListener( 'pointerup', up ); handle.removeEventListener( 'pointercancel', up );
					const finalHeight = pane.getBoundingClientRect().height;
					setDescriptionPaneHeight( name, finalHeight, true );
					try { handle.releasePointerCapture( e.pointerId ); } catch ( err ) {}
				};
				handle.addEventListener( 'pointermove', move ); handle.addEventListener( 'pointerup', up ); handle.addEventListener( 'pointercancel', up );
			} );
			handle.addEventListener( 'dblclick', () => setDescriptionPaneHeight( handle.dataset.descResizeHandle, DESCRIPTION_PANE_DEFAULTS[ handle.dataset.descResizeHandle ] || 520, true ) );
		} );
	}
	function toggleDescriptionFullscreen( force ) {
		if ( ! els.descriptionCard ) return;
		const next = typeof force === 'boolean' ? force : ! els.descriptionCard.classList.contains( 'is-fullscreen' );
		els.descriptionCard.classList.toggle( 'is-fullscreen', next );
		document.body.classList.toggle( 'description-fullscreen-open', next );
		if ( els.descriptionFullscreen ) {
			els.descriptionFullscreen.setAttribute( 'aria-label', next ? 'Quitter le plein écran' : 'Agrandir la zone de description' );
			els.descriptionFullscreen.title = next ? 'Quitter le plein écran' : 'Agrandir la zone de description';
		}
		if ( ! next ) restoreDescriptionPaneHeights();
	}
	function previewFrameHasContent() {
		try {
			const doc = els.descriptionPreview && els.descriptionPreview.contentDocument;
			if ( ! doc || ! doc.body ) return false;
			return !! ( String( doc.body.textContent || '' ).trim() || doc.querySelector( 'img' ) );
		} catch ( e ) { return false; }
	}
	function writePreviewDocumentFallback( docHtml ) {
		try {
			const doc = els.descriptionPreview && els.descriptionPreview.contentDocument;
			if ( ! doc ) return false;
			doc.open(); doc.write( docHtml ); doc.close();
			return true;
		} catch ( e ) { return false; }
	}
	function renderDescriptionPreviewFrame( docHtml, expectContent ) {
		if ( ! els.descriptionPreview ) return;
		if ( els.descriptionPreviewShell ) els.descriptionPreviewShell.classList.remove( 'is-preview-error' );
		let retried = false;
		const verify = () => {
			if ( ! expectContent || previewFrameHasContent() ) return;
			if ( ! retried ) { retried = true; if ( writePreviewDocumentFallback( docHtml ) ) { window.setTimeout( verify, 80 ); return; } }
			if ( els.descriptionPreviewShell ) els.descriptionPreviewShell.classList.add( 'is-preview-error' );
		};
		els.descriptionPreview.onload = () => window.setTimeout( verify, 20 );
		els.descriptionPreview.srcdoc = docHtml;
		window.setTimeout( verify, 180 );
	}

	function descriptionPreviewDocument( html, emptyMessage ) {
		const body = html ? html : `<p class="cdh-empty">${ esc( emptyMessage ) }</p>`;
		return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
		*{box-sizing:border-box}html,body{margin:0;padding:0;max-width:100%;overflow-x:hidden;background:#fff;color:#1f2937;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}.cdh-preview{padding:22px;max-width:100%;overflow-wrap:anywhere;word-break:normal}.cdh-preview img{display:block;max-width:100%!important;width:auto!important;height:auto!important;margin:12px auto}.cdh-preview p{max-width:100%!important;margin:.15em 0 .85em}.cdh-preview div,.cdh-preview span,.cdh-preview table{max-width:100%!important}.cdh-preview table{width:100%!important;border-collapse:collapse}.cdh-preview pre{white-space:pre-wrap;overflow-wrap:anywhere}.cdh-preview h1,.cdh-preview h2,.cdh-preview h3,.cdh-preview h4{line-height:1.25;margin:1.15em 0 .5em}.cdh-preview ul,.cdh-preview ol{padding-left:26px}.cdh-empty{color:#8b96a1;margin:0;padding:0}</style></head><body><div class="cdh-preview">${ body }</div></body></html>`;
	}
	function descriptionUiState() {
		const html = String( els.descriptionInput.value || '' ).trim();
		const status = state && state.descriptionStatus ? state.descriptionStatus : ( html ? 'extracted' : 'not_found' );
		if ( status === 'disabled' ) return { status, kind: 'warn', label: 'Description désactivée dans le profil d’extraction WordPress.', summary: 'Désactivée' };
		if ( html ) return { status: 'extracted', kind: 'ok', label: els.includeDescription.checked ? '✓ Description détectée · incluse dans WooCommerce' : '✓ Description détectée · non incluse dans WooCommerce', summary: els.includeDescription.checked ? 'Incluse' : 'Détectée · non incluse' };
		const required = !! els.includeDescription.checked;
		if ( status === 'iframe_inaccessible' ) return { status, kind: required ? 'error' : 'warn', label: required ? 'Description requise mais inaccessible dans la fiche AliExpress.' : 'Description repérée mais inaccessible · non bloquant tant qu’elle n’est pas incluse.', summary: 'Inaccessible' };
		if ( status === 'timeout' ) return { status, kind: required ? 'error' : 'warn', label: required ? 'Description requise : extraction à vérifier avant import.' : 'Extraction de la description à vérifier · optionnelle pour cet import.', summary: 'Extraction à vérifier' };
		if ( status === 'runtime_url_only' ) return { status, kind: required ? 'error' : 'warn', label: required ? 'Description requise : sa source est repérée mais son contenu reste inaccessible.' : 'Source de description repérée · contenu non chargé, non bloquant.', summary: 'Source repérée' };
		return { status: 'not_found', kind: 'warn', label: 'Aucune description détectée sur cette fiche AliExpress.', summary: 'Non détectée' };
	}

	function updateDescriptionPreview() {
		const html = sanitizeDescriptionForEditor( String( els.descriptionInput.value || '' ).trim() );
		const ui = descriptionUiState();
		let emptyMessage = 'Aucune description détectée sur cette fiche AliExpress.';
		if ( ui.status === 'timeout' ) emptyMessage = 'La description n’a pas pu être chargée. Ré-analyse la fiche pour relancer son extraction.';
		if ( ui.status === 'iframe_inaccessible' ) emptyMessage = 'La description est présente sur AliExpress mais son contenu n’est pas lisible par l’extension.';
		if ( ui.status === 'runtime_url_only' ) emptyMessage = 'La source de description a été repérée dans les données AliExpress, mais le contenu n’est pas chargé dans la page.';
		const previewDoc = descriptionPreviewDocument( html, emptyMessage );
		renderDescriptionPreviewFrame( previewDoc, !! html );
		if ( els.descriptionState ) {
			els.descriptionState.className = 'description-state is-' + ui.kind;
			els.descriptionState.textContent = ui.label;
		}
		updateDescriptionMeta();
	}

	function setCheck( id, ok, value, mode ) {
		const row = $( id ); const val = $( id + '-value' ); if ( ! row || ! val ) return;
		row.classList.remove( 'ok', 'warn', 'error' ); row.classList.add( mode || ( ok ? 'ok' : 'error' ) ); row.querySelector( '.check-dot' ).textContent = ok ? '✓' : ( mode === 'warn' ? '!' : '×' ); val.textContent = value;
	}

	function updateSummary( payload, validation ) {
		const shopCurrency = shopConfig && shopConfig.currency ? String( shopConfig.currency ).toUpperCase() : '';
		const supplierCurrency = String( payload.base_price.currency || '' ).toUpperCase();
		setCheck( 'check-title', !! payload.title, payload.title ? 'OK' : 'Manquant' );
		setCheck( 'check-price', payload.base_price.amount > 0, payload.base_price.amount > 0 ? `${ supplierCurrency || shopCurrency || '' } ${ payload.base_price.amount }`.trim() : 'Manquant' );
		const shippingStats = supplierShippingSummary( payload.shipping_current, payload.base_price.amount, payload.supplier_variations );
		if ( ! extractionEnabled( 'shipping', true ) ) setCheck( 'check-shipping', true, 'Désactivée', 'warn' );
		else if ( shippingStats.feeKnown ) setCheck( 'check-shipping', true, shippingUiLabel( payload.shipping_current, payload.base_price.amount, payload.supplier_variations ), 'ok' );
		else if ( shippingStats.detected ) setCheck( 'check-shipping', true, shippingUiLabel( payload.shipping_current, payload.base_price.amount, payload.supplier_variations ), 'warn' );
		else setCheck( 'check-shipping', true, 'Non détectée', 'warn' );
		if ( ! shopCurrency ) setCheck( 'check-currency', false, supplierCurrency || '—', 'warn' );
		else setCheck( 'check-currency', supplierCurrency === shopCurrency, supplierCurrency === shopCurrency ? shopCurrency : `${ supplierCurrency || '—' } ≠ ${ shopCurrency }` );
		const selectedCategory = loadedCategories.find( ( c ) => String( c.id ) === String( payload.category_id ) );
		setCheck( 'check-category', true, selectedCategory ? categoryPath( selectedCategory ) : 'Optionnelle', selectedCategory ? 'ok' : 'warn' );
		if ( ! extractionEnabled( 'images', true ) ) setCheck( 'check-images', true, 'Désactivées', 'warn' ); else setCheck( 'check-images', payload.images.length > 0, `${ payload.images.length } image${ payload.images.length > 1 ? 's' : '' }` );
		const optionCount = ( state.variantGroups || [] ).reduce( ( sum, g ) => sum + ( g.options || [] ).length, 0 );
		const invalidVariantName = ( state.variantGroups || [] ).some( ( g ) => ! String( g && ( g.sourceAttribute || g.attribute ) || '' ).trim() || ! targetAttributeName( g ) );
		const invalidVariantValue = ( state.variantGroups || [] ).some( ( g ) => ( g.options || [] ).some( ( o ) => ! String( o && o.value || '' ).trim() || ! targetOptionValue( o ) ) );
		const variantsEnabled = extractionEnabled( 'variants', true );
		const variantsOk = ! variantsEnabled || ( ! invalidVariantName && ! invalidVariantValue );
		const variantsLabel = ! variantsEnabled ? 'Désactivées' : ! optionCount ? 'Produit simple' : invalidVariantName ? 'Correspondance d’attribut requise' : invalidVariantValue ? 'Valeur WooCommerce manquante' : `${ state.variantGroups.length } attr. · ${ optionCount } val.`;
		setCheck( 'check-variants', variantsOk, variantsLabel, ! variantsEnabled ? 'warn' : ( variantsOk ? 'ok' : 'error' ) );

		const pricingConfig = shopConfig && shopConfig.pricing ? shopConfig.pricing : null;
		const hasVariantDimensions = optionCount > 0;
		const skuItems = Array.isArray( payload.supplier_variations ) ? payload.supplier_variations : [];
		const matrixSummary = supplierMatrixCoverage( payload );
		const skuReady = ! hasVariantDimensions || ( matrixSummary.complete && skuItems.length > 0 && skuItems.every( ( item ) => item.supplier_sku_id && item.supplier_price && Number( item.supplier_price.amount ) > 0 ) );
		const skuLabel = ! hasVariantDimensions
			? ( skuItems.length ? `${ skuItems.length } SKU observé${ skuItems.length > 1 ? 's' : '' }` : 'Non requis' )
			: matrixSummary.exact && matrixSummary.expectedSkus != null
				? `${ matrixSummary.verifiedSkus }/${ matrixSummary.expectedSkus } SKU vérifiés`
				: skuReady ? `${ skuItems.length } SKU vérifiés` : `${ matrixSummary.mappedSkus }/${ matrixSummary.verifiedSkus || skuItems.length } SKU mappés`;
		setCheck( 'check-sku', skuReady, skuLabel, skuReady ? 'ok' : 'error' );
		const stockStats = supplierStockSummary( skuItems );
		const stockReady = ! skuItems.length ? ! hasVariantDimensions : stockStats.knownCount === skuItems.length;
		const stockLabel = ! skuItems.length ? ( hasVariantDimensions ? 'Non détecté' : 'Non requis' ) : supplierStockLabel( skuItems, true );
		setCheck( 'check-stock', stockReady, stockLabel, stockReady ? 'ok' : 'warn' );

		const pricingReady = !! ( pricingConfig && pricingConfig.configured );
		const pricingLabel = pricingReady ? `${ pricingConfig.name || 'Règle par défaut' } · v${ Number( pricingConfig.version || 0 ) }` : 'Non configurée';
		setCheck( 'check-pricing', pricingReady, pricingLabel, pricingReady ? 'ok' : 'error' );
		const selectedCharacteristics = ( state.characteristics || [] ).filter( ( item ) => item.selected && String( item.name || '' ).trim() && String( item.value || '' ).trim() ).length;
		if ( ! extractionEnabled( 'characteristics', true ) ) setCheck( 'check-characteristics', true, 'Désactivées', 'warn' ); else setCheck( 'check-characteristics', true, `${ selectedCharacteristics } / ${ ( state.characteristics || [] ).length }`, selectedCharacteristics ? 'ok' : 'warn' );
		const docs = Array.isArray( payload.documents ) ? payload.documents : []; const docsSelected = docs.filter( ( doc ) => doc && doc.import_to_wordpress !== false ).length;
		if ( ! extractionEnabled( 'documents', true ) ) setCheck( 'check-documents', true, 'Désactivés', 'warn' ); else setCheck( 'check-documents', true, docs.length ? `${ docsSelected }/${ docs.length } sélectionné${ docsSelected > 1 ? 's' : '' }` : 'Aucun', docs.length ? 'ok' : 'warn' );
		const descriptionUi = descriptionUiState();
		setCheck( 'check-description', descriptionUi.kind !== 'error', descriptionUi.summary, descriptionUi.kind === 'error' ? 'error' : ( descriptionUi.kind === 'ok' ? 'ok' : 'warn' ) );
		$( 'summary-heading' ).textContent = validation.ok ? 'Prêt à importer' : 'Import à vérifier';
	}

	function updateValidation() {
		if ( ! state ) return;
		const payload = currentPayload(); const shopCurrency = shopConfig && shopConfig.currency ? shopConfig.currency : '';
		const validation = validatePayload( payload, shopCurrency, shopConfig && shopConfig.extraction ? shopConfig.extraction : null );
		if ( ! shopConfig || ! shopConfig.pricing || ! shopConfig.pricing.configured ) { validation.errors.push( 'Règle de tarification WordPress non configurée.' ); validation.ok = false; }
		els.footerErrors.hidden = validation.errors.length === 0; els.footerErrors.innerHTML = '';
		validation.errors.forEach( ( error ) => { const li = document.createElement( 'li' ); li.textContent = error; els.footerErrors.appendChild( li ); } );
		const hasSettings = !! ( els.siteUrlInput.value.trim() && els.apiKeyInput.value.trim() );
		els.importBtn.disabled = ! ( validation.ok && hasSettings && shopCurrency );
		updateDescriptionPreview(); updateCurrencyUi(); updateSummary( payload, validation ); updateDestination();
	}

	async function analyze() {
		setStatus( 'Analyse de la fiche…' ); els.main.classList.remove( 'visible' );
		const previousCategoryId = state && state.category_id != null ? state.category_id : urlCategoryId; state = null;
		openVariantGroupKeys.clear(); variantUiInitialized = false;
		const tabId = getSourceTabId(); if ( tabId == null ) { setStatus( 'Onglet AliExpress source introuvable.', 'error' ); return; }
		let response; try { response = await chrome.tabs.sendMessage( tabId, { type: 'CDH_EXTRACT_PRODUCT', extraction: shopConfig && shopConfig.extraction ? shopConfig.extraction : null } ); } catch ( err ) { setStatus( 'Impossible de communiquer avec la fiche AliExpress. Recharge-la puis ré-analyse.', 'error' ); return; }
		if ( ! response || response.ok !== true || ! response.result || ! response.result.data ) { setStatus( 'Erreur pendant l’extraction de la fiche.', 'error' ); return; }
		const data = response.result.data;
		selectedImageIndex = 0;
		state = {
			supplier_key: data.supplier_key, supplier_product_id: data.supplier_product_id, supplier_url: data.supplier_url, brand: data.brand, availability: data.availability, rating: data.rating,
			images: ( data.images || [] ).slice(), imageMediaIds: ( data.images || [] ).map( () => null ), video: data.video && data.video.content_url ? { source_url: data.video.content_url, thumbnail_url: data.video.thumbnail_url || '' } : null, videoImport: false, videoAddDescription: false, videoMediaId: null, videoWordPressUrl: '', originalVideoThumbnail: data.video && data.video.thumbnail_url ? data.video.thumbnail_url : '', documents: Array.isArray( data.documents ) ? data.documents.map( ( doc ) => ( { ...doc, import_to_wordpress: true, media_id: null, url: '' } ) ) : [], sizeGuide: data.size_guide || null, sizeGuideInclude: !! data.size_guide, shippingCurrent: data.shipping_current || null, variantGroups: applyCatalogMappings( groupVariants( data.variants ) ), supplierVariations: Array.isArray( data.supplier_variations ) ? data.supplier_variations : [], supplierVariantDimensions: Array.isArray( data.supplier_variant_dimensions ) ? data.supplier_variant_dimensions : [], supplierSkuSource: data.supplier_sku_source || '', supplierSkuCapturedAt: data.supplier_sku_captured_at || '', supplierSkuDiagnostics: data.supplier_sku_diagnostics || {}, characteristics: normalizeCharacteristics( data.attributes || [] ), supplier: data.supplier || {}, category_id: previousCategoryId,
			priceCurrency: data.base_price && data.base_price.currency ? String( data.base_price.currency ).toUpperCase() : '',
			descriptionStatus: data.description_status || ( data.description_html ? 'extracted' : 'not_found' ),
			descriptionDiagnostics: data.description_diagnostics || {},
			originalDescriptionHtml: data.description_html || '',
		};
		els.titleInput.value = data.title || ''; els.priceInput.value = data.base_price ? data.base_price.amount : ''; els.includeDescription.checked = false; els.descriptionInput.value = data.description_html || ''; renderDescriptionEditor();
		renderMeta( data ); els.headerSource.textContent = data.supplier_product_id ? `AliExpress · ${ data.supplier_product_id }` : 'AliExpress';
		if ( data.video && data.video.content_url ) { els.videoCard.hidden = false; els.videoEmpty.hidden = true; els.videoPlayer.src = data.video.content_url; if ( data.video.thumbnail_url ) els.videoPlayer.poster = data.video.thumbnail_url; else els.videoPlayer.removeAttribute( 'poster' ); els.mediaVideoCount.textContent = '(1)'; els.includeVideo.checked = false; els.videoAddDescription.checked = false; els.videoAddDescription.disabled = true; els.videoImportNote.textContent = 'Non importée'; els.videoStatusChip.textContent = 'AliExpress'; }
		else { els.videoCard.hidden = true; els.videoEmpty.hidden = false; els.videoPlayer.removeAttribute( 'src' ); els.videoPlayer.removeAttribute( 'poster' ); els.mediaVideoCount.textContent = ''; }
		renderGallery(); renderDocuments(); renderVariantGroups(); renderPricing(); renderCharacteristics(); updateValidation(); els.main.classList.add( 'visible' );
		setStatus( response.result.ok ? 'Fiche analysée' : 'Fiche analysée · corrections requises', response.result.ok ? 'ok' : 'warn' );
	}

	async function uploadLocalImages( payload ) {
		const mediaIds = Array.isArray( payload.image_media_ids ) ? payload.image_media_ids.slice() : payload.images.map( () => null );
		for ( let i = 0; i < payload.images.length; i++ ) {
			if ( ! isLocalImage( payload.images[i] ) ) continue;
			setStatus( `Envoi de l’image modifiée ${ i + 1 }/${ payload.images.length }…` );
			const response = await chrome.runtime.sendMessage( { type: 'CDH_IMPORT_MEDIA', payload: { data_url: payload.images[i], filename: `constello-edited-${ Date.now() }-${ i + 1 }.png` } } );
			if ( ! response || ! response.ok ) throw new Error( response && response.message ? response.message : 'Échec de l’envoi d’une image modifiée.' );
			payload.images[i] = response.url; mediaIds[i] = response.media_id;
		}
		payload.image_media_ids = mediaIds;
		for ( let i = 0; i < ( payload.variants || [] ).length; i++ ) {
			const variant = payload.variants[i];
			if ( ! variant || ! isLocalImage( variant.image_url ) ) continue;
			setStatus( `Envoi de l’image de variante ${ i + 1 }/${ payload.variants.length }…` );
			const response = await chrome.runtime.sendMessage( { type: 'CDH_IMPORT_MEDIA', payload: { data_url: variant.image_url, filename: `constello-variant-${ Date.now() }-${ i + 1 }.webp` } } );
			if ( ! response || ! response.ok ) throw new Error( response && response.message ? response.message : 'Échec de l’envoi d’une image de variante.' );
			variant.image_url = response.url; variant.image_media_id = response.media_id;
		}
		return payload;
	}

	async function uploadVideoIfRequested( payload ) {
		if ( ! payload.video || ! payload.video.import_to_wordpress || payload.video.media_id ) return payload;
		setStatus( 'Import de la vidéo dans WordPress…' );
		const response = await chrome.runtime.sendMessage( { type: 'CDH_IMPORT_VIDEO', payload: { source_url: payload.video.source_url } } );
		if ( ! response || ! response.ok ) throw new Error( response && response.message ? response.message : 'Échec de l’import de la vidéo.' );
		payload.video.media_id = Number( response.media_id || 0 ) || null; payload.video.url = response.url || '';
		state.videoMediaId = payload.video.media_id; state.videoWordPressUrl = payload.video.url; els.videoImportNote.textContent = 'Prête dans WordPress'; els.videoStatusChip.textContent = 'Médiathèque WordPress';
		return payload;
	}


	async function uploadDocumentsIfRequested( payload ) {
		if ( ! Array.isArray( payload.documents ) || ! payload.documents.length ) return payload;
		for ( let i = 0; i < payload.documents.length; i++ ) {
			const doc = payload.documents[i];
			if ( ! doc || doc.import_to_wordpress === false || doc.media_id ) continue;
			setStatus( `Import du document ${ i + 1 }/${ payload.documents.length }…` );
			const response = await chrome.runtime.sendMessage( { type: 'CDH_IMPORT_DOCUMENT', payload: { source_url: doc.source_url, filename: doc.filename, title: doc.title, type: doc.type } } );
			if ( ! response || ! response.ok ) throw new Error( response && response.message ? response.message : 'Échec de l’import d’un document PDF.' );
			doc.media_id = Number( response.media_id || 0 ) || null; doc.url = response.url || '';
			if ( state && state.documents && state.documents[i] ) { state.documents[i].media_id = doc.media_id; state.documents[i].url = doc.url; }
		}
		return payload;
	}

	async function doImport() {
		if ( ! state ) return;
		let payload = currentPayload(); const shopCurrency = shopConfig && shopConfig.currency ? shopConfig.currency : '';
		const validation = validatePayload( payload, shopCurrency, shopConfig && shopConfig.extraction ? shopConfig.extraction : null );
		if ( ! shopConfig || ! shopConfig.pricing || ! shopConfig.pricing.configured ) { validation.errors.push( 'Règle de tarification WordPress non configurée.' ); validation.ok = false; } if ( ! validation.ok ) { updateValidation(); return; }
		els.importBtn.disabled = true; setStatus( 'Préparation de l’import…' );
		try {
			payload = await uploadLocalImages( payload );
			payload = await uploadVideoIfRequested( payload );
			payload = await uploadDocumentsIfRequested( payload );
			const response = await chrome.runtime.sendMessage( { type: 'CDH_IMPORT', payload } );
			if ( response && response.ok ) {
				setStatus(
					response.idempotent_replay
						? 'Produit déjà importé · fiche WooCommerce existante ouverte, aucun doublon créé.'
						: 'Produit créé avec le statut « Import AliExpress » · fiche WooCommerce ouverte.',
					'ok'
				);
			}
			else { setStatus( 'Échec de l’import : ' + ( response && response.message ? response.message : 'erreur inconnue.' ), 'error' ); updateValidation(); }
		} catch ( err ) { setStatus( 'Échec de l’import : ' + ( err && err.message ? err.message : String( err ) ), 'error' ); updateValidation(); }
	}

	function bindTabs() {
		document.querySelectorAll( '[data-media-tab]' ).forEach( ( btn ) => btn.addEventListener( 'click', () => {
			document.querySelectorAll( '[data-media-tab]' ).forEach( ( b ) => b.classList.toggle( 'active', b === btn ) );
			$( 'media-images-pane' ).hidden = btn.dataset.mediaTab !== 'images'; $( 'media-video-pane' ).hidden = btn.dataset.mediaTab !== 'video';
		} ) );
		document.querySelectorAll( '[data-desc-tab]' ).forEach( ( btn ) => btn.addEventListener( 'click', () => {
			const target = btn.dataset.descTab;
			if ( target !== 'edit' && ! $( 'desc-edit-pane' ).hidden ) syncDescriptionFromEditor();
			document.querySelectorAll( '[data-desc-tab]' ).forEach( ( b ) => b.classList.toggle( 'active', b === btn ) );
			$( 'desc-preview-pane' ).hidden = target !== 'preview'; $( 'desc-edit-pane' ).hidden = target !== 'edit'; $( 'desc-html-pane' ).hidden = target !== 'html';
			if ( target === 'edit' ) { renderDescriptionEditor(); els.descriptionEditor.focus(); }
			if ( target === 'preview' ) updateDescriptionPreview();
		} ) );
	}

	els.galleryMainImg.addEventListener( 'error', () => {
		els.galleryMainImg.style.visibility = 'hidden';
		els.galleryMainState.textContent = 'Aperçu indisponible · vérifie l’URL source';
	} );
	els.videoPlayer.addEventListener( 'error', () => {
		els.videoCard.hidden = true; els.videoEmpty.hidden = false;
		els.videoEmpty.textContent = 'Aperçu vidéo indisponible. Ré-analyse la fiche pour récupérer une URL fournisseur valide.';
	} );

	els.importBtn.addEventListener( 'click', doImport ); els.reanalyzeBtn.addEventListener( 'click', analyze );
	els.addImageBtn.addEventListener( 'click', () => { if ( ! state ) return; state.images.push( '' ); state.imageMediaIds.push( null ); selectedImageIndex = state.images.length - 1; renderGallery(); updateValidation(); els.galleryMainUrl.focus(); } );
	els.galleryMainUrl.addEventListener( 'input', () => {
		if ( ! state || ! state.images.length ) return;
		const raw = els.galleryMainUrl.value.trim();
		if ( raw && isForbiddenMediaUrl( raw ) ) {
			els.galleryMainState.textContent = 'Ressource locale temporaire refusée';
			els.galleryMainImg.removeAttribute( 'src' ); els.galleryMainImg.style.visibility = 'hidden';
			return;
		}
		const safe = raw ? normalizeEditorMediaUrl( raw ) : '';
		if ( raw && ! safe ) { els.galleryMainState.textContent = 'URL HTTPS requise'; return; }
		state.images[ selectedImageIndex ] = safe; state.imageMediaIds[ selectedImageIndex ] = null;
		if ( safe ) els.galleryMainImg.src = safe; else els.galleryMainImg.removeAttribute( 'src' );
		els.galleryMainImg.style.visibility = safe ? 'visible' : 'hidden';
		const selected = els.galleryThumbs.querySelector( '.gallery-thumb--selected img' ); if ( selected && safe ) selected.src = safe;
		els.galleryMainState.textContent = isLocalImage( safe ) ? 'Modifiée localement' : ''; updateValidation();
	} );
	els.setMainBtn.addEventListener( 'click', setSelectedAsMain );
	els.galleryMoveLeft.addEventListener( 'click', () => moveImage( selectedImageIndex, selectedImageIndex - 1 ) );
	els.galleryMoveRight.addEventListener( 'click', () => moveImage( selectedImageIndex, selectedImageIndex + 1 ) );
	els.galleryDeleteSelected.addEventListener( 'click', removeSelectedImage );
	document.addEventListener( 'cdh:duplicate-selected-image', duplicateSelectedImage );
	document.querySelectorAll( '[data-theme-choice]' ).forEach( ( btn ) => btn.addEventListener( 'click', () => setTheme( btn.dataset.themeChoice ) ) );
	els.characteristicsSelectAll.addEventListener( 'click', () => { if ( ! state ) return; state.characteristics.forEach( ( item ) => { item.selected = true; } ); renderCharacteristics(); updateValidation(); } );
	els.characteristicsSelectNone.addEventListener( 'click', () => { if ( ! state ) return; state.characteristics.forEach( ( item ) => { item.selected = false; } ); renderCharacteristics(); updateValidation(); } );
	els.characteristicsDeleteAll.addEventListener( 'click', () => { if ( ! state || ! state.characteristics.length ) return; if ( ! confirm( `Supprimer les ${ state.characteristics.length } caractéristiques détectées de cette préparation ?` ) ) return; state.characteristics = []; renderCharacteristics(); updateValidation(); } );
	document.addEventListener( 'cdh:external-image-updated', ( event ) => {
		if ( ! state || ! event.detail || ! /^variant:/.test( String( event.detail.targetId || '' ) ) ) return;
		const parts = String( event.detail.targetId ).split( ':' ); const gIdx = Number( parts[1] ), oIdx = Number( parts[2] );
		const opt = state.variantGroups && state.variantGroups[gIdx] && state.variantGroups[gIdx].options && state.variantGroups[gIdx].options[oIdx];
		if ( ! opt || ! event.detail.dataUrl ) return; opt.imageUrl = event.detail.dataUrl; opt.imageModified = true; opt.imageMediaId = null; renderVariantGroups(); updateValidation();
	} );
		els.variantsExpandAll.addEventListener( 'click', () => { els.variantGroups.querySelectorAll( 'details.variant-group' ).forEach( ( item ) => { item.open = true; if ( item.dataset.groupKey ) openVariantGroupKeys.add( item.dataset.groupKey ); } ); } );
	els.variantsCollapseAll.addEventListener( 'click', () => { els.variantGroups.querySelectorAll( 'details.variant-group' ).forEach( ( item ) => { item.open = false; if ( item.dataset.groupKey ) openVariantGroupKeys.delete( item.dataset.groupKey ); } ); } );
	els.addGroupBtn.addEventListener( 'click', () => { const group = { attribute: '', sourceAttribute: '', options: [ { value: '', wooValue: '', imageUrl: null } ] }; const key = variantGroupUiKey( group, state.variantGroups.length ); openVariantGroupKeys.add( key ); state.variantGroups.push( group ); renderVariantGroups(); renderPricing(); updateValidation(); } );
	els.categorySelect.addEventListener( 'change', () => selectCategory( els.categorySelect.value || null ) );
	els.categoryTrigger.addEventListener( 'click', () => { const opening = els.categoryPanel.hidden; els.categoryPanel.hidden = ! opening; els.categoryTrigger.setAttribute( 'aria-expanded', opening ? 'true' : 'false' ); if ( opening ) { renderCategoryOptions( els.categorySearch.value ); setTimeout( () => els.categorySearch.focus(), 0 ); } } );
	els.categorySearch.addEventListener( 'input', () => renderCategoryOptions( els.categorySearch.value ) );
	document.addEventListener( 'click', ( event ) => { if ( els.categoryPicker && ! els.categoryPicker.contains( event.target ) ) { els.categoryPanel.hidden = true; els.categoryTrigger.setAttribute( 'aria-expanded', 'false' ); } } );
	document.addEventListener( 'keydown', ( event ) => { if ( event.key === 'Escape' && els.categoryPanel && ! els.categoryPanel.hidden ) { els.categoryPanel.hidden = true; els.categoryTrigger.setAttribute( 'aria-expanded', 'false' ); els.categoryTrigger.focus(); } } );
	els.includeVideo.addEventListener( 'change', () => { if ( ! state || ! state.video ) return; state.videoImport = els.includeVideo.checked; els.videoAddDescription.disabled = ! state.videoImport; if ( ! state.videoImport ) { state.videoAddDescription = false; els.videoAddDescription.checked = false; els.videoImportNote.textContent = 'Non importée'; } else els.videoImportNote.textContent = 'Sera importée'; updateValidation(); } );
	els.videoAddDescription.addEventListener( 'change', () => { if ( ! state ) return; state.videoAddDescription = els.videoAddDescription.checked; } );
	els.videoUseGalleryThumb.addEventListener( 'click', () => { if ( ! state || ! state.video || ! state.images.length ) return; const source = state.images[ selectedImageIndex ]; if ( source && ! isLocalImage( source ) ) { state.video.thumbnail_url = source; els.videoPlayer.poster = source; } } );
	els.videoResetThumb.addEventListener( 'click', () => { if ( ! state || ! state.video ) return; state.video.thumbnail_url = state.originalVideoThumbnail || ''; if ( state.video.thumbnail_url ) els.videoPlayer.poster = state.video.thumbnail_url; else els.videoPlayer.removeAttribute( 'poster' ); } );
	els.includeDescription.addEventListener( 'change', updateValidation );
	els.descriptionInput.addEventListener( 'input', () => { if ( state ) state.descriptionStatus = els.descriptionInput.value.trim() ? 'extracted' : 'not_found'; renderDescriptionEditor(); updateValidation(); } );
	els.descriptionEditor.addEventListener( 'input', () => { window.clearTimeout( els.descriptionEditor._cdhTimer ); els.descriptionEditor._cdhTimer = window.setTimeout( syncDescriptionFromEditor, 180 ); } );
	els.descriptionEditor.addEventListener( 'paste', ( e ) => { e.preventDefault(); const text = ( e.clipboardData || window.clipboardData ).getData( 'text/plain' ); document.execCommand( 'insertText', false, text ); } );
	els.descriptionEditor.addEventListener( 'click', ( e ) => { if ( selectedDescriptionImage ) selectedDescriptionImage.classList.remove( 'is-selected' ); selectedDescriptionImage = e.target && e.target.tagName === 'IMG' ? e.target : null; if ( selectedDescriptionImage ) selectedDescriptionImage.classList.add( 'is-selected' ); els.descriptionRemoveImage.disabled = ! selectedDescriptionImage; } );
	document.querySelectorAll( '.desc-editor-tool' ).forEach( ( btn ) => btn.addEventListener( 'mousedown', ( e ) => e.preventDefault() ) );
	document.querySelectorAll( '[data-desc-command]' ).forEach( ( btn ) => btn.addEventListener( 'click', () => { els.descriptionEditor.focus(); document.execCommand( btn.dataset.descCommand, false, null ); syncDescriptionFromEditor(); } ) );
	document.querySelectorAll( '[data-desc-block]' ).forEach( ( btn ) => btn.addEventListener( 'click', () => { els.descriptionEditor.focus(); document.execCommand( 'formatBlock', false, btn.dataset.descBlock ); syncDescriptionFromEditor(); } ) );
	els.descriptionRemoveImage.addEventListener( 'click', () => { if ( ! selectedDescriptionImage ) return; selectedDescriptionImage.remove(); selectedDescriptionImage = null; els.descriptionRemoveImage.disabled = true; syncDescriptionFromEditor(); } );
	els.descriptionRestore.addEventListener( 'click', () => { if ( ! state ) return; const original = String( state.originalDescriptionHtml || '' ); if ( els.descriptionInput.value !== original && ! confirm( 'Restaurer la description AliExpress originale et annuler les modifications ?' ) ) return; els.descriptionInput.value = original; state.descriptionStatus = original.trim() ? 'extracted' : 'not_found'; renderDescriptionEditor(); updateValidation(); } );
	if ( els.descriptionFullscreen ) els.descriptionFullscreen.addEventListener( 'click', () => toggleDescriptionFullscreen() );
	document.addEventListener( 'keydown', ( e ) => { if ( e.key === 'Escape' && els.descriptionCard && els.descriptionCard.classList.contains( 'is-fullscreen' ) ) { e.preventDefault(); toggleDescriptionFullscreen( false ); } } );
	bindDescriptionResizers(); restoreDescriptionPaneHeights();
	window.addEventListener( 'resize', () => { if ( ! ( els.descriptionCard && els.descriptionCard.classList.contains( 'is-fullscreen' ) ) ) restoreDescriptionPaneHeights(); } );
	els.titleInput.addEventListener( 'input', updateValidation ); els.priceInput.addEventListener( 'input', updateValidation );
	els.saveSettingsBtn.addEventListener( 'click', saveSettings ); els.settingsToggle.addEventListener( 'click', () => { els.settingsPanel.hidden = false; } ); els.settingsClose.addEventListener( 'click', () => { els.settingsPanel.hidden = true; } ); els.settingsPanel.addEventListener( 'click', ( e ) => { if ( e.target === els.settingsPanel ) els.settingsPanel.hidden = true; } );
	[ els.siteUrlInput, els.apiKeyInput ].forEach( ( input ) => input.addEventListener( 'input', () => { updateDestination(); updateValidation(); } ) );
	bindTabs();

	( async function init() {
		readUrlParams(); bindWorkspaceNavigation(); await loadWorkspaceOrder(); await loadTheme(); await loadSettings(); if ( urlOpenSettings ) els.settingsPanel.hidden = false;
		await loadShopConfig(); await analyze(); await loadCategoryOptions(); updateValidation();
	} )();

} )( typeof window !== 'undefined' ? window : globalThis );
