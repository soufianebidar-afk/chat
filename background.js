/**
 * cdh-import-extension — background.js (service worker, Manifest V3)
 *
 * Deux rôles : (1) ouvrir `editor.html` en plein onglet au clic sur l'icône de l'extension —
 * remplace depuis le 2026-08-31 le petit popup (360px), jugé trop étroit pour éditer titre,
 * images, description et variantes avant l'envoi (cf. §13 du cahier des charges) — et (2) relayer
 * l'appel réseau vers l'endpoint WordPress déjà validé (§6.3, étape 1 de l'ordre de développement,
 * §11) une fois l'édition confirmée dans `editor.html`, puis ouvrir l'écran de revue (§7) au
 * succès. Ne lit JAMAIS le DOM AliExpress lui-même — ça reste le rôle exclusif de
 * content-script.js (§6.2) ; ce fichier ne fait que relayer des données déjà extraites et déjà
 * éditées, avec authentification par clé API (en-tête X-CDH-Api-Key, §4 — pas de Basic Auth
 * WordPress, cf. §13 pour l'historique de cette décision, Application Passwords bloquées par
 * Wordfence).
 *
 * Cahier des charges : claude/constello-dropshipping-hub-lot-v1a-import-cahier-des-charges.md §6.3
 */

const IMPORT_PATH = '/wp-json/cdh/v1/import';
const CATEGORIES_PATH = '/wp-json/cdh/v1/categories';
const CONFIG_PATH = '/wp-json/cdh/v1/config';
const IMPORT_MEDIA_PATH = '/wp-json/cdh/v1/import-media';
const IMPORT_VIDEO_PATH = '/wp-json/cdh/v1/import-video';
const IMPORT_DOCUMENT_PATH = '/wp-json/cdh/v1/import-document';
const LOOKUP_PRODUCT_PATH = '/wp-json/cdh/v1/products/lookup';
const ATTRIBUTE_MAPPING_PATH = '/wp-json/cdh/v1/catalog/mappings';

// La clé API reste accessible uniquement aux contextes de confiance de l'extension
// (service worker + pages chrome-extension://), jamais aux content scripts injectés sur AliExpress.
if ( typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && chrome.storage.local.setAccessLevel ) {
	chrome.storage.local.setAccessLevel( { accessLevel: 'TRUSTED_CONTEXTS' } ).catch( () => {} );
}

// Pas de `default_popup` dans manifest.json depuis le 2026-08-31 (cf. §13) : chrome.action.onClicked
// ne se déclenche QUE si aucun popup n'est déclaré — ouvre `editor.html` en plein onglet, en lui
// passant l'onglet source (celui actif au moment du clic, censé être la fiche AliExpress) via un
// paramètre d'URL. `editor.js` vérifie lui-même que ce tabId correspond bien à une fiche AliExpress
// avant de tenter l'extraction — mêmes messages d'aide que l'ancien popup.js si ce n'est pas le cas.
//
// Depuis le 2026-08-31 (§6.4, bandeau injecté sur la fiche AliExpress par banner.js), ce même flux
// d'ouverture sert aussi au clic sur « Éditez »/⚙ du bandeau — d'où l'extraction en deux fonctions
// réutilisables (buildEditorUrl/openEditorTab) plutôt que la seule ligne inline d'origine.
function buildEditorUrl( sourceTabId, extra ) {
	const params = new URLSearchParams();
	params.set( 'sourceTabId', sourceTabId != null ? String( sourceTabId ) : '' );
	if ( extra && extra.categoryId != null && extra.categoryId !== '' ) params.set( 'categoryId', String( extra.categoryId ) );
	if ( extra && extra.categoryName ) params.set( 'categoryName', String( extra.categoryName ) );
	if ( extra && extra.openSettings ) params.set( 'openSettings', '1' );
	return chrome.runtime.getURL( 'editor.html' ) + '?' + params.toString();
}

function openEditorTab( sourceTabId, extra ) {
	return chrome.tabs.create( { url: buildEditorUrl( sourceTabId, extra ) } );
}


function sendTabMessageWithTimeout( tabId, message, timeoutMs ) {
	return new Promise( ( resolve ) => {
		let settled = false;
		const finish = ( value ) => {
			if ( settled ) return;
			settled = true;
			clearTimeout( timer );
			resolve( value );
		};
		const timer = setTimeout( () => finish( { ok: false, status: 'timeout', timedOut: true } ), Math.max( 250, Number( timeoutMs ) || 5000 ) );
		try {
			// API callback volontairement utilisée ici : contrairement à l'ancien chaînage
			// `.finally()` sur la valeur de retour, elle fonctionne aussi dans les contextes Chrome
			// où sendMessage ne renvoie pas une Promise. Une absence de réponse ne peut donc plus
			// laisser le bandeau bloqué sur « Analyse… ».
			chrome.tabs.sendMessage( tabId, message, ( response ) => {
				if ( chrome.runtime.lastError ) {
					finish( { ok: false, error: chrome.runtime.lastError.message || 'content_script_unavailable' } );
					return;
				}
				finish( response || { ok: false, status: 'no_response' } );
			} );
		} catch ( err ) {
			finish( { ok: false, error: err && err.message ? err.message : String( err ) } );
		}
	} );
}

async function prepareDescriptionBeforeEditor( sourceTabId ) {
	if ( sourceTabId == null ) return { ok: false, skipped: true };
	return sendTabMessageWithTimeout(
		sourceTabId,
		{ type: 'CDH_PREPARE_DESCRIPTION', maxWaitMs: 4200, intervalMs: 180 },
		5000
	);
}

const editorOpenJobs = new Map();

async function prepareAndOpenEditor( sourceTabId, extra ) {
	// Le préchargement de description reste un best-effort. Il n'est plus précédé d'un appel
	// /config : l'ouverture de l'éditeur ne dépend d'aucune requête WordPress. Au pire, après
	// 5 secondes, l'éditeur s'ouvre et relance lui-même ses fallbacks d'extraction.
	const descriptionPreparation = await prepareDescriptionBeforeEditor( sourceTabId );
	await openEditorTab( sourceTabId, extra );
	return {
		ok: true,
		descriptionPrepared: !! ( descriptionPreparation && descriptionPreparation.ok && descriptionPreparation.status === 'extracted' ),
		descriptionStatus: descriptionPreparation && descriptionPreparation.status ? descriptionPreparation.status : null,
	};
}

function queueEditorOpen( sourceTabId, extra ) {
	const key = sourceTabId == null ? 'none' : String( sourceTabId );
	if ( editorOpenJobs.has( key ) ) return editorOpenJobs.get( key );
	const job = prepareAndOpenEditor( sourceTabId, extra )
		.catch( ( err ) => {
			console.warn( '[CDH] Ouverture éditeur échouée', err );
			return { ok: false, error: err && err.message ? err.message : String( err ) };
		} )
		.finally( () => editorOpenJobs.delete( key ) );
	editorOpenJobs.set( key, job );
	return job;
}

if ( typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked ) {
	chrome.action.onClicked.addListener( ( tab ) => {
		prepareAndOpenEditor( tab && tab.id != null ? tab.id : null, null );
	} );
}

// Tolère que Soufiane colle l'URL du site avec ou sans protocole, avec ou sans slash final —
// évite un échec silencieux sur un détail de saisie plutôt qu'un vrai problème réseau/auth.
function normalizeSiteUrl( raw ) {
	if ( ! raw ) return '';
	let url = String( raw ).trim();
	if ( ! /^https?:\/\//i.test( url ) ) url = 'https://' + url;
	return url.replace( /\/+$/, '' );
}

// Réglages communs à l'import ET à /categories (2026-08-31) — extrait pour ne pas dupliquer les
// deux mêmes vérifications « URL manquante »/« clé manquante » à deux endroits.
async function getSiteConfig() {
	const { cdh_site_url, cdh_api_key } = await chrome.storage.local.get( [ 'cdh_site_url', 'cdh_api_key' ] );
	const siteUrl = normalizeSiteUrl( cdh_site_url );

	if ( ! siteUrl ) {
		return { error: { ok: false, code: 'missing_settings', message: 'URL du site non renseignée — ouvre les réglages de l\'extension (⚙).' } };
	}
	if ( ! cdh_api_key ) {
		return { error: { ok: false, code: 'missing_settings', message: 'Clé API non renseignée — ouvre les réglages de l\'extension (⚙), copiée depuis Réglages → CDH – Import sur le site.' } };
	}
	return { siteUrl, apiKey: cdh_api_key };
}

async function requestJson( path, options ) {
	const { siteUrl, apiKey, error } = await getSiteConfig();
	if ( error ) return error;

	let response;
	try {
		response = await fetch( siteUrl + path, {
			...( options || {} ),
			headers: {
				'X-CDH-Api-Key': apiKey,
				...( options && options.body ? { 'Content-Type': 'application/json' } : {} ),
				...( options && options.headers ? options.headers : {} ),
			},
		} );
	} catch ( err ) {
		return {
			ok: false,
			code: 'network_error',
			message: `Impossible de contacter ${ siteUrl }. Vérifie l’adresse de la boutique et réessaie.`,
		};
	}

	let body = null;
	try { body = await response.json(); } catch ( e ) {}
	return { response, body, siteUrl };
}

async function handleImport( payload ) {
	const { siteUrl, apiKey, error } = await getSiteConfig();
	if ( error ) return error;

	let response;
	try {
		response = await fetch( siteUrl + IMPORT_PATH, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-CDH-Api-Key': apiKey,
			},
			body: JSON.stringify( payload ),
		} );
	} catch ( err ) {
		// L’accès HTTPS aux boutiques est accordé au niveau du manifeste. Une erreur ici
		// correspond donc à une indisponibilité réseau, DNS/TLS ou à une URL de boutique incorrecte.
		return {
			ok: false,
			code: 'network_error',
			message: `Impossible de contacter ${ siteUrl }. Vérifie l’adresse de la boutique et réessaie.`,
		};
	}

	let body = null;
	try {
		body = await response.json();
	} catch ( e ) {
		// Réponse non-JSON (ex. page d'erreur HTML de l'hébergeur/Wordfence) — pas le format
		// attendu du contrat §6.3, mais ne doit pas faire planter silencieusement l'extension ;
		// `body` reste `null`, géré ci-dessous via le repli `http_<status>`.
	}

	// 201 = produit créé, 200 = reprise idempotente d'un produit existant.
	if ( response.ok && body && body.review_url ) {
		let safeReviewUrl = '';
		try {
			const review = new URL( body.review_url );
			const site = new URL( siteUrl );
			if ( review.origin === site.origin && review.protocol === 'https:' ) safeReviewUrl = review.href;
		} catch ( e ) {}
		if ( ! safeReviewUrl ) return { ok: false, code: 'invalid_review_url', message: 'Le serveur a renvoyé une URL de fiche WooCommerce invalide.' };
		chrome.tabs.create( { url: safeReviewUrl } );
		return {
			ok: true,
			review_url: safeReviewUrl,
			product_id: Number( body.product_id || 0 ) || null,
			created: body.created !== false,
			idempotent_replay: body.idempotent_replay === true,
			import_action: body.import_action || ( body.idempotent_replay === true ? 'existing' : 'created' ),
		};
	}

	// Contrat d'erreur §6.3 : `{ code, message, data: { status } }` — format natif `WP_Error`
	// sérialisé par `WP_REST_Server`, PAS `{ error, reason }` (corrigé le 2026-08-30 après test
	// réel contre staging.soldit.ch, cf. §13). `body.code`/`body.message`, jamais
	// `body.error`/`body.reason`.
	const code = ( body && body.code ) || `http_${ response.status }`;
	const message = ( body && body.message ) || `Réponse inattendue du serveur (statut ${ response.status }).`;
	return { ok: false, code, message };
}

// GET /categories (2026-08-31, §6.4) — même conventions d'erreur que handleImport ci-dessus
// (missing_settings avant tout fetch, network_error si le fetch échoue, repli http_<statut> si le
// corps n'est pas JSON exploitable) : banner.js n'a qu'à distinguer `ok`/`code` comme editor.js le
// fait déjà pour CDH_IMPORT, pas de nouveau format à apprendre.
async function handleGetCategories() {
	const { siteUrl, apiKey, error } = await getSiteConfig();
	if ( error ) return error;

	let response;
	try {
		response = await fetch( siteUrl + CATEGORIES_PATH, {
			method: 'GET',
			headers: { 'X-CDH-Api-Key': apiKey },
		} );
	} catch ( err ) {
		return {
			ok: false,
			code: 'network_error',
			message: `Impossible de contacter ${ siteUrl }. Vérifie l’adresse de la boutique et réessaie.`,
		};
	}

	let body = null;
	try {
		body = await response.json();
	} catch ( e ) {
		// Réponse non-JSON — même repli que handleImport ci-dessus.
	}

	if ( response.status === 200 && body && Array.isArray( body.categories ) ) {
		return { ok: true, categories: body.categories };
	}

	const code = ( body && body.code ) || `http_${ response.status }`;
	const message = ( body && body.message ) || `Réponse inattendue du serveur (statut ${ response.status }).`;
	return { ok: false, code, message };
}

async function handleGetConfig() {
	const result = await requestJson( CONFIG_PATH, { method: 'GET' } );
	if ( result.ok === false ) return result;
	const { response, body } = result;
	if ( response.status === 200 && body && body.currency ) return { ok: true, config: body };
	return { ok: false, code: ( body && body.code ) || `http_${ response.status }`, message: ( body && body.message ) || `Réponse inattendue du serveur (statut ${ response.status }).` };
}

async function handleSaveAttributeMapping( payload ) {
	const result = await requestJson( ATTRIBUTE_MAPPING_PATH, { method: 'POST', body: JSON.stringify( payload || {} ) } );
	if ( result.ok === false ) return result;
	const { response, body } = result;
	if ( response.status === 200 && body && body.ok ) return { ok: true, mapping: body.mapping || null };
	return { ok: false, code: ( body && body.code ) || `http_${ response.status }`, message: ( body && body.message ) || `Réponse inattendue du serveur (statut ${ response.status }).` };
}

async function handleImportMedia( payload ) {
	const result = await requestJson( IMPORT_MEDIA_PATH, { method: 'POST', body: JSON.stringify( payload || {} ) } );
	if ( result.ok === false ) return result;
	const { response, body } = result;
	if ( response.status === 201 && body && body.media_id && body.url ) {
		return { ok: true, media_id: body.media_id, url: body.url, width: body.width || 0, height: body.height || 0, mime: body.mime || '' };
	}
	return { ok: false, code: ( body && body.code ) || `http_${ response.status }`, message: ( body && body.message ) || `Réponse inattendue du serveur (statut ${ response.status }).` };
}

async function handleImportVideo( payload ) {
	const result = await requestJson( IMPORT_VIDEO_PATH, { method: 'POST', body: JSON.stringify( payload || {} ) } );
	if ( result.ok === false ) return result;
	const { response, body } = result;
	if ( response.status === 201 && body && body.media_id && body.url ) {
		return { ok: true, media_id: body.media_id, url: body.url, mime: body.mime || '', filename: body.filename || '' };
	}
	return { ok: false, code: ( body && body.code ) || `http_${ response.status }`, message: ( body && body.message ) || `Réponse inattendue du serveur (statut ${ response.status }).` };
}


async function handleImportDocument( payload ) {
	const result = await requestJson( IMPORT_DOCUMENT_PATH, { method: 'POST', body: JSON.stringify( payload || {} ) } );
	if ( result.ok === false ) return result;
	const { response, body } = result;
	if ( response.status === 201 && body && body.media_id && body.url ) return { ok: true, media_id: body.media_id, url: body.url, mime: body.mime || '', filename: body.filename || '' };
	return { ok: false, code: ( body && body.code ) || `http_${ response.status }`, message: ( body && body.message ) || `Réponse inattendue du serveur (statut ${ response.status }).` };
}

async function handleLookupProduct( payload ) {
	const supplierKey = payload && payload.supplier_key ? String( payload.supplier_key ) : 'aliexpress';
	const supplierProductId = payload && payload.supplier_product_id ? String( payload.supplier_product_id ) : '';
	if ( ! supplierProductId ) return { ok: false, code: 'missing_supplier_product_id', message: 'Identifiant produit AliExpress introuvable.' };

	const query = new URLSearchParams( {
		supplier_key: supplierKey,
		supplier_product_id: supplierProductId,
	} );
	const result = await requestJson( LOOKUP_PRODUCT_PATH + '?' + query.toString(), { method: 'GET' } );
	if ( result.ok === false ) return result;
	const { response, body } = result;
	if ( response.status === 200 && body && typeof body.found === 'boolean' ) {
		return { ok: true, lookup: body };
	}
	return { ok: false, code: ( body && body.code ) || `http_${ response.status }`, message: ( body && body.message ) || `Réponse inattendue du serveur (statut ${ response.status }).` };
}

async function handleGetUiState() {
	const stored = await chrome.storage.local.get( [ 'cdh_site_url', 'cdh_api_key', 'constello_theme' ] );
	return {
		ok: true,
		site_url: normalizeSiteUrl( stored.cdh_site_url || '' ),
		has_api_key: !! stored.cdh_api_key,
		theme: [ 'system', 'light', 'dark' ].includes( stored.constello_theme ) ? stored.constello_theme : 'system',
	};
}

async function handleSaveSettings( payload ) {
	const incoming = payload || {};
	const siteUrl = normalizeSiteUrl( incoming.site_url || '' );
	if ( ! siteUrl ) return { ok: false, code: 'missing_site_url', message: 'URL du site WordPress requise.' };

	let site;
	try { site = new URL( siteUrl ); } catch ( e ) {
		return { ok: false, code: 'invalid_site_url', message: 'URL du site WordPress invalide.' };
	}
	if ( site.protocol !== 'https:' ) {
		return { ok: false, code: 'https_required', message: 'Le site WordPress doit utiliser HTTPS.' };
	}

	const stored = await chrome.storage.local.get( [ 'cdh_api_key', 'cdh_site_url', 'constello_theme' ] );
	const newKey = String( incoming.api_key || '' ).trim();
	const apiKey = newKey || String( stored.cdh_api_key || '' ).trim();
	if ( ! apiKey ) return { ok: false, code: 'missing_api_key', message: 'Clé API requise.' };

	// L’accès HTTPS aux boutiques est déclaré au niveau du manifeste.
	// Ici on valide uniquement la connexion métier (site + clé Constello).

	let response;
	try {
		response = await fetch( siteUrl + CONFIG_PATH, {
			method: 'GET',
			headers: { 'X-CDH-Api-Key': apiKey },
		} );
	} catch ( err ) {
		return { ok: false, code: 'network_error', message: `Impossible de contacter ${ site.hostname }. Vérifie l’URL et réessaie.` };
	}

	let body = null;
	try { body = await response.json(); } catch ( e ) {}
	if ( response.status !== 200 || ! body || ! body.currency ) {
		return {
			ok: false,
			code: ( body && body.code ) || `http_${ response.status }`,
			message: ( body && body.message ) || 'Connexion WordPress refusée. Vérifie la clé API.',
		};
	}

	const theme = [ 'system', 'light', 'dark' ].includes( incoming.theme )
		? incoming.theme
		: ( [ 'system', 'light', 'dark' ].includes( stored.constello_theme ) ? stored.constello_theme : 'system' );
	await chrome.storage.local.set( { cdh_site_url: siteUrl, cdh_api_key: apiKey, constello_theme: theme } );
	return { ok: true, config: body, site_url: siteUrl, theme };
}

async function handleOpenSiteUrl( rawUrl ) {
	const { siteUrl, error } = await getSiteConfig();
	if ( error ) return error;
	let target;
	let site;
	try {
		target = new URL( String( rawUrl || '' ) );
		site = new URL( siteUrl );
	} catch ( e ) {
		return { ok: false, code: 'invalid_site_url', message: 'URL WordPress invalide.' };
	}
	if ( target.protocol !== 'https:' || target.origin !== site.origin ) {
		return { ok: false, code: 'invalid_site_url', message: 'Cette URL ne correspond pas au site WordPress configuré.' };
	}
	chrome.tabs.create( { url: target.href } );
	return { ok: true };
}

chrome.runtime.onMessage.addListener( ( message, sender, sendResponse ) => {
	if ( ! message ) return; // pas pour nous, laisse un autre écouteur répondre.

	if ( message.type === 'CDH_IMPORT' ) {
		handleImport( message.payload )
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true; // réponse asynchrone (sendResponse appelé après la Promise ci-dessus).
	}

	if ( message.type === 'CDH_GET_CATEGORIES' ) {
		handleGetCategories()
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}

	if ( message.type === 'CDH_GET_CONFIG' ) {
		handleGetConfig()
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}

	if ( message.type === 'CDH_SAVE_ATTRIBUTE_MAPPING' ) {
		handleSaveAttributeMapping( message.payload )
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}

	if ( message.type === 'CDH_IMPORT_MEDIA' ) {
		handleImportMedia( message.payload )
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}

	if ( message.type === 'CDH_IMPORT_VIDEO' ) {
		handleImportVideo( message.payload )
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}


	if ( message.type === 'CDH_IMPORT_DOCUMENT' ) {
		handleImportDocument( message.payload )
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}

	if ( message.type === 'CDH_LOOKUP_PRODUCT' ) {
		handleLookupProduct( message.payload )
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}

	if ( message.type === 'CDH_GET_UI_STATE' ) {
		handleGetUiState()
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}

	if ( message.type === 'CDH_SAVE_SETTINGS' ) {
		handleSaveSettings( message.payload )
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}

	if ( message.type === 'CDH_OPEN_SITE_URL' ) {
		handleOpenSiteUrl( message.url )
			.then( ( result ) => sendResponse( result ) )
			.catch( ( err ) => sendResponse( { ok: false, code: 'unexpected_error', message: err && err.message ? err.message : String( err ) } ) );
		return true;
	}

	if ( message.type === 'CDH_OPEN_EDITOR' ) {
		// ACK immédiat au bandeau : il ne reste plus verrouillé pendant le lazy-loading de la
		// description. L'ouverture réelle est ensuite exécutée en tâche indépendante et bornée.
		const sourceTabId = sender && sender.tab && sender.tab.id != null ? sender.tab.id : null;
		sendResponse( { ok: true, queued: true } );
		queueEditorOpen( sourceTabId, message );
		return false;
	}
} );
