/**
 * cdh-import-extension — content-script.js
 *
 * Injecté sur les fiches produit AliExpress (*://*.aliexpress.com/item/*, cf. manifest.json).
 * L'extraction standard reste passive. Depuis 1.12.1, si le stock par SKU n'est pas exposé
 * dans le payload initial, le bridge MAIN peut effectuer une résolution active STRICTEMENT
 * bornée en sélectionnant uniquement des options appartenant à des SKU réels déjà vérifiés.
 * Aucun ajout panier, aucune combinaison théorique et aucune quantité inventée.
 *
 * Étape 3 de l'ordre de développement (§11) : extraction SEULE, à tester en collant ce
 * fichier dans la console DevTools d'une vraie fiche AliExpress, puis en appelant
 * `CDH.extractProduct()` — pas encore branché à l'extension (popup/background), pas encore
 * de connexion réseau. Objectif : valider la FORME des données sur plusieurs fiches réelles
 * (au moins un produit simple, un à plusieurs dimensions de variantes) avant d'aller plus loin.
 *
 * Cahier des charges : claude/constello-dropshipping-hub-lot-v1a-import-cahier-des-charges.md §6.2
 */

(function (root) {
	'use strict';

	// ---------------------------------------------------------------------
	// 1. Bloc JSON-LD — §6.2.1
	// ---------------------------------------------------------------------
	// Confirmé empiriquement le 2026-08-28 (debug.html) : AliExpress renvoie un TABLEAU à la
	// racine ([{"@type":"Product",...},{"@type":"VideoObject",...}]), pas un objet nu ni un
	// {"@graph":[...]}. On gère les trois formes par prudence — un site qui change de structure
	// entre deux visites n'est pas à exclure, mieux vaut ne pas re-casser sur un format proche.
	// Renvoie AUSSI l'entrée VideoObject (2026-08-31, cf. §13) — jusqu'ici trouvée dans le même
	// tableau mais jamais lue, alors qu'elle contient un `contentUrl` exploitable (confirmé sur une
	// vraie fiche : URL .mp4 directe vers video.aliexpress-media.com, pas juste une miniature).
	function findJsonLdEntries() {
		const scripts = document.querySelectorAll( 'script[type="application/ld+json"]' );
		let product = null;
		let video = null;
		for ( const script of scripts ) {
			let parsed;
			try {
				parsed = JSON.parse( script.textContent );
			} catch ( e ) {
				continue; // bloc JSON-LD mal formé (rare, mais mieux vaut ignorer que planter) — on continue avec le suivant.
			}

			const candidates = Array.isArray( parsed )
				? parsed
				: Array.isArray( parsed && parsed[ '@graph' ] )
					? parsed[ '@graph' ]
					: [ parsed ];

			if ( ! product ) product = candidates.find( ( entry ) => entry && entry[ '@type' ] === 'Product' ) || null;
			if ( ! video ) video = candidates.find( ( entry ) => entry && entry[ '@type' ] === 'VideoObject' ) || null;
			if ( product && video ) break;
		}
		return { product, video };
	}

	// Dédoublonnage ajouté le 2026-08-31 (retour terrain, produit « Dodge RAM 1000 TRX ») :
	// AliExpress peut lister la même URL d'image plusieurs fois dans le bloc JSON-LD (observé en
	// conditions réelles : la première image du tableau répétée deux fois de suite) — sans
	// conséquence fonctionnelle grave (§7 permettrait de la voir en double à la revue), mais
	// inutile d'envoyer un doublon exact au serveur. Comparaison par chaîne exacte (pas de
	// normalisation d'URL) : suffisant ici, l'observé est une répétition strictement identique.
	//
	// Repli seulement depuis le 2026-08-31 (cf. extractGalleryImagesFromDom() ci-dessous) :
	// `product.image[]` dans le JSON-LD s'est révélé être un sous-ensemble incomplet de la galerie
	// réelle (observé à 2 URLs uniques sur une fiche qui en affichait 9) — la galerie complète est
	// maintenant lue depuis le DOM en priorité, ceci n'intervient que si cette lecture DOM ne
	// trouve rien (page qui aurait changé de structure).

	// Les médias fournisseur doivent rester des ressources réseau stables. Les URLs locales
	// (`file:`, `blob:`, `chrome-extension:`) sont volontairement exclues de l'extraction :
	// elles ne survivraient pas à un rechargement/mise à jour de l'extension et peuvent produire
	// ERR_FILE_NOT_FOUND dans Chrome. La politique est volontairement HTTPS-only.
	function normalizeSupplierMediaUrl( raw ) {
		if ( ! raw ) return '';
		let value = String( raw ).trim();
		if ( value.startsWith( '//' ) ) value = 'https:' + value;
		try {
			const url = new URL( value, location.href );
			if ( url.protocol !== 'https:' ) return '';
			return url.href;
		} catch ( e ) { return ''; }
	}

	function extractImagesFromJsonLd( product ) {
		if ( ! product || ! product.image ) return [];
		const raw = Array.isArray( product.image ) ? product.image.filter( Boolean ) : [ product.image ];
		return Array.from( new Set( raw.map( normalizeSupplierMediaUrl ).filter( Boolean ) ) );
	}

	// Galerie complète lue depuis le rail de miniatures du DOM (2026-08-31, retour terrain fiche
	// « spot LED ») — remplace `product.image[]` (JSON-LD) comme source principale, celui-ci s'étant
	// révélé incomplet (§ ci-dessus). Confirmé par inspection directe du DOM réel de cette fiche
	// (`item/1005009587413681.html`) : un seul rail de miniatures sur toute la page
	// (`[class*="slider--item--"]`, 10 éléments — 1 vidéo + 9 photos), positionné juste sous le
	// titre, conteneur commun unique (pas de collision avec un autre carrousel plus bas sur la
	// page, ex. « produits similaires »). Sélecteur volontairement en préfixe de classe plutôt
	// qu'une classe exacte : le suffixe (ex. `--RpyeewA`) est un hash de build AliExpress
	// susceptible de changer d'un déploiement à l'autre, `slider--item--` étant la partie stable
	// de la convention CSS Modules observée.
	//
	// Le premier élément du rail est la vidéo (miniature + icône de lecture), pas une photo —
	// repéré par un descendant dont la classe contient "video"/"play" (confirmé présent
	// uniquement sur cet élément dans le rail testé) et exclu d'ici : la vidéo est déjà gérée par
	// `extractVideoFromJsonLd()` (contentUrl direct, plus fiable que cette miniature seule).
	//
	// Chaque URL est nettoyée du suffixe de redimensionnement que le CDN ajoute parfois sur les
	// miniatures pas encore chargées en pleine résolution (ex.
	// « ....jpg_220x220q75.jpg_.avif », confirmé en conditions réelles) en coupant à la première
	// extension d'image rencontrée — récupère l'image d'origine plutôt qu'une vignette basse
	// résolution.
	function extractGalleryImagesFromDom() {
		const items = document.querySelectorAll( '[class*="slider--item--"]' );
		const urls = [];
		for ( const item of items ) {
			if ( item.querySelector( '[class*="video" i], [class*="play" i]' ) ) continue; // slot vidéo, pas une photo
			const img = item.querySelector( 'img' );
			if ( ! img ) continue;
			const raw = img.currentSrc || img.src || img.getAttribute( 'data-src' ) || '';
			if ( ! raw ) continue;
			const match = raw.match( /^(.*?\.(?:jpg|jpeg|png|webp))/i );
			const normalized = normalizeSupplierMediaUrl( match ? match[ 1 ] : raw );
			if ( normalized ) urls.push( normalized );
		}
		return Array.from( new Set( urls ) );
	}

	// Vidéo produit (2026-08-31, cf. §13) : `contentUrl` confirmé être un fichier .mp4 direct sur
	// une vraie fiche (pas un lien d'intégration à parser) — utilisable tel quel dans une balise
	// <video> côté editor.js, sans requête supplémentaire déclenchée par ce script (on lit
	// seulement ce que le JSON-LD contient déjà, comme pour tout le reste de ce fichier).
	// Purement informatif pour l'instant : pas envoyé au serveur (absent du contrat §6.3), affiché
	// dans l'éditeur pour référence visuelle uniquement.
	function extractVideoFromJsonLd( video ) {
		if ( ! video || ! video.contentUrl ) return null;
		const contentUrl = normalizeSupplierMediaUrl( video.contentUrl );
		if ( ! contentUrl ) return null;
		const thumbs = Array.isArray( video.thumbnailUrl )
			? video.thumbnailUrl.filter( Boolean )
			: ( video.thumbnailUrl ? [ video.thumbnailUrl ] : [] );
		return {
			content_url: contentUrl,
			thumbnail_url: thumbs.map( normalizeSupplierMediaUrl ).find( Boolean ) || null,
		};
	}

	function extractBasePrice( product ) {
		if ( ! product || ! product.offers ) return null;
		// `offers` peut être un objet Offer unique, un tableau d'Offer (plusieurs variantes), ou
		// un AggregateOffer (lowPrice/highPrice) — on prend le prix le plus bas disponible dans
		// tous les cas, cohérent avec "prix de base" (§2 : un seul prix pour tout le produit).
		const offers = Array.isArray( product.offers ) ? product.offers : [ product.offers ];
		let best = null;
		for ( const offer of offers ) {
			if ( ! offer ) continue;
			const amount = parseFloat( offer.price ?? offer.lowPrice );
			if ( ! isNaN( amount ) && ( best === null || amount < best.amount ) ) {
				best = { amount, currency: offer.priceCurrency || null };
			}
		}
		return best;
	}

	function extractAvailability( product ) {
		const raw = product && product.offers
			? ( Array.isArray( product.offers ) ? product.offers[ 0 ]?.availability : product.offers.availability )
			: null;
		if ( ! raw ) return '';
		// Format schema.org habituel : "https://schema.org/InStock" → "in_stock".
		const last = String( raw ).split( '/' ).pop() || '';
		return last
			.replace( /([a-z])([A-Z])/g, '$1_$2' )
			.toLowerCase();
	}

	function extractRating( product ) {
		const agg = product && product.aggregateRating;
		if ( ! agg ) return { value: null, count: null };
		const value = parseFloat( agg.ratingValue );
		const count = parseInt( agg.reviewCount ?? agg.ratingCount, 10 );
		return {
			value: isNaN( value ) ? null : value,
			count: isNaN( count ) ? null : count,
		};
	}

	// ---------------------------------------------------------------------
	// 2. Variantes visibles — §6.2.2
	// ---------------------------------------------------------------------
	// Confirmé empiriquement (debug.html) : `[data-sku-col]` au format "{row}-{optionId}",
	// libellé dans l'attribut `alt` de l'`<img>` contenue (le texte de l'élément est souvent
	// vide). On lit l'ensemble des options affichées, sans cliquer sur rien — pas de prix par
	// combinaison dans ce lot (§2).
	//
	// Le nom de la dimension (« couleur », « taille »...) n'est PAS garanti extractible de façon
	// fiable sans avoir vu le HTML réel autour de chaque data-sku-row — heuristique ci-dessous
	// (texte du plus proche libellé ancêtre), avec repli sur un identifiant générique `dimN` si
	// rien de lisible n'est trouvé. Sans conséquence fonctionnelle grave si le repli s'active :
	// §7 (écran de revue) permet justement à Soufiane de renommer/mapper chaque variante vers un
	// attribut WooCommerce — l'extraction n'a pas besoin de deviner juste, seulement de rester
	// stable. **Point à vérifier en priorité en testant sur une vraie fiche (§11 étape 3).**
	// `ownLabels` : libellés (en minuscules) des options de CETTE ligne elle-même — sert à
	// rejeter un faux positif trouvé en conditions réelles le 2026-08-31 : un élément voisin dont
	// le texte est la simple concaténation des options ("30cm45cm" au lieu de "Taille"), pris à
	// tort pour le nom de la dimension. Un vrai nom de dimension ne contient normalement aucune
	// des valeurs qu'il regroupe.
	//
	// Deuxième correction, même jour, retour terrain sur une fiche « spot LED » : AliExpress
	// affiche très souvent un texte "Dimension : Valeur sélectionnée" juste au-dessus des
	// vignettes (ex. "Puissance: 7W", "Couleur de l'abat-jour: Not Dimmable" — confirmé par
	// capture d'écran de Soufiane). La garde ci-dessus (rejet si le texte contient une des
	// options) ratait ce cas quand la valeur sélectionnée fait 1-2 caractères ("7W" → 2, sous le
	// seuil de 3 fixé pour éviter un autre faux rejet) : le texte entier "Puissance: 7W" passait
	// alors la garde et était accepté tel quel comme nom de dimension → slugifié en
	// "puissance-7w" au lieu de "puissance". À l'inverse, pour les dimensions dont la valeur fait
	// ≥ 3 caractères ("Not Dimmable", "White and black"...), la garde rejetait bien le texte
	// complet, mais aucun autre candidat n'étant trouvé à proximité, le résultat retombait sur le
	// repli générique (`dimN`, champ vide dans l'éditeur) au lieu d'un nom lisible — alors que le
	// vrai nom ("Couleur de l'abat-jour") était juste avant le ":" tout du long.
	// **Nouveau repli PRIORITAIRE** : si le texte candidat contient un ":", ne garder que la
	// partie AVANT — fiable quelle que soit la longueur de la valeur sélectionnée après, puisque
	// cette valeur n'est simplement jamais incluse dans ce qu'on retient. Résout les deux
	// symptômes d'un coup (contamination sur "puissance-7w" ET rejet total sur les 3 autres
	// dimensions de la même fiche). L'ancienne heuristique (rejet par concaténation) reste en
	// repli pour les libellés SANS ":" (ex. le cas "30cm45cm" déjà couvert par un test).
	function guessDimensionLabel( rowContainer, ownLabels ) {
		if ( ! rowContainer ) return null;
		const searchRoots = [ rowContainer, rowContainer.parentElement, rowContainer.parentElement?.parentElement ].filter( Boolean );
		for ( const el of searchRoots ) {
			for ( const child of el.children || [] ) {
				if ( child.hasAttribute && child.hasAttribute( 'data-sku-col' ) ) continue;
				const text = ( child.textContent || '' ).trim();
				if ( ! text || text.length > 60 || /^[0-9\s]*$/.test( text ) ) continue;

				const colonMatch = text.match( /^([^:：]{1,40})[:：]\s*\S.*$/ );
				if ( colonMatch ) {
					const label = colonMatch[ 1 ].trim();
					if ( label ) return label;
					continue; // ":" présent mais rien d'exploitable avant — retente le repli ci-dessous.
				}

				const lower = text.toLowerCase();
				// Seuil de 3 caractères : un libellé d'1-2 caractères ("M", "L", "XL"...) apparaît
				// comme simple sous-chaîne dans quantité de mots sans rapport (ex. "L" dans
				// "Taille") — le rejeter sur ce seul critère ferait perdre de vrais noms de
				// dimension. Le bug réel visé ("30cm45cm") a des libellés de 4 caractères, donc
				// toujours détecté avec ce seuil. Le cas des valeurs courtes SANS ":" (théorique,
				// pas rencontré) reste une limite connue de ce repli secondaire.
				const isJustTheOptionsConcatenated = ( ownLabels || [] ).some( ( label ) => label && label.length >= 3 && lower.includes( label ) );
				if ( isJustTheOptionsConcatenated ) continue;
				return text;
			}
		}
		return null;
	}

	function slugify( text ) {
		return String( text )
			.trim()
			.toLowerCase()
			.normalize( 'NFD' )
			.replace( /[̀-ͯ]/g, '' ) // accents
			.replace( /[^a-z0-9]+/g, '-' )
			.replace( /^-+|-+$/g, '' ) || 'x';
	}

	function extractVariants() {
		const nodes = Array.from( document.querySelectorAll( '[data-sku-col]' ) );

		// Regroupement en deux passes : il faut connaître les libellés de TOUTES les options
		// d'une ligne avant de deviner le nom de sa dimension (cf. guessDimensionLabel ci-dessus).
		const rows = new Map(); // row (string) -> { container, nodes: [...] }
		for ( const node of nodes ) {
			const skuCol = node.getAttribute( 'data-sku-col' ) || '';
			const row = skuCol.split( '-' )[ 0 ] || 'x';
			if ( ! rows.has( row ) ) {
				rows.set( row, {
					container: node.closest( '[data-sku-row]' ) || node.parentElement,
					nodes: [],
				} );
			}
			rows.get( row ).nodes.push( node );
		}

		const variants = [];
		for ( const [ row, { container, nodes: rowNodes } ] of rows ) {
			const infos = rowNodes.map( ( node ) => {
				const img = node.querySelector( 'img' );
				// L'attribut alt porte le libellé réel — le textContent de l'élément est souvent
				// vide (confirmé empiriquement) : ne PAS s'appuyer dessus en premier.
				const labelRaw = ( ( img && img.getAttribute( 'alt' ) )
					|| node.getAttribute( 'title' )
					|| node.getAttribute( 'aria-label' )
					|| ( node.textContent || '' ).trim()
					|| node.getAttribute( 'data-sku-col' ) ).trim();
				return { img, labelRaw };
			} );

			const ownLabels = infos.map( ( i ) => i.labelRaw.toLowerCase() ).filter( Boolean );
			const guessed = guessDimensionLabel( container, ownLabels );
			const dimensionSlug = guessed ? slugify( guessed ) : `dim${ row }`;

			for ( const info of infos ) {
				variants.push( {
					supplier_variation_key: `${ dimensionSlug }:${ slugify( info.labelRaw ) }`,
					label_raw: info.labelRaw,
					image_url: info.img && info.img.src ? ( normalizeSupplierMediaUrl( info.img.src ) || null ) : null,
					// `dimension_label` (2026-08-31) : le texte lisible deviné AVANT slugification
					// (ex. "Couleur de l'abat-jour"), en plus de `supplier_variation_key` qui ne
					// contient que sa forme slugifiée ("couleur-de-l-abat-jour"). N'est PAS envoyé
					// au serveur (absent du contrat §6.3, editor.js ne le reprend que pour
					// pré-remplir le champ "Attribut" avec un texte agréable à relire/corriger,
					// plutôt que le slug). `null` si le repli générique `dimN` s'est activé.
					dimension_label: guessed || null,
				} );
			}
		}

		return variants;
	}

	// ---------------------------------------------------------------------
	// 3. Description — §6.2.3
	// ---------------------------------------------------------------------
	// AliExpress a fait varier ce conteneur par le passé (refontes de page produit) — liste de
	// sélecteurs candidats, essayés dans l'ordre, plutôt qu'un seul pari. **À confirmer/ajuster
	// contre une vraie fiche (§11 étape 3)** : capturé une fois via debug.html le 2026-08-28,
	// pas encore vérifié systématiquement sur plusieurs fiches.
	// Confirmé empiriquement le 2026-08-31 (fiche réelle, capture DevTools) : AliExpress utilise
	// un jeu d'ancres de sections stables — `#nav-review`, `#nav-specification`, `#nav-description`
	// — bien plus fiable que les classes générées à la volée qu'on voit à côté
	// (`extend--content--VuIQZia`, suffixe visiblement propre à la build, à ne pas figer en dur).
	// `[class*="extend--content--"]` cible le bloc de contenu réel À L'INTÉRIEUR de #nav-description
	// (sans le titre d'onglet ni le bouton "voir plus"), avec repli sur la section entière si cette
	// classe interne venait à changer.
	// #nav-description entier n'est PLUS dans cette liste (contrairement à une version
	// précédente) : confirmé réel le 2026-08-31 — sur cette fiche, son contenu véritable vit
	// dans un `<iframe>` (cf. extractDescriptionHtml/debugIframe ci-dessous), donc prendre tout
	// le nœud renvoyait le titre de l'onglet + le bouton « Voir plus » comme si c'était la
	// description — un faux succès trompeur, pire qu'un vide franc.
	// `#product-description` / `.product-description` : PAS un piège permanent, mais la cause
	// réelle du conteneur vide n'est PAS un problème de timing (correction du 2026-08-31, prise
	// 2 — la première correction du même jour était elle-même incomplète, cf. §13 du cahier des
	// charges). Cause confirmée par capture complète de page (Elements panel) sur la fiche
	// disque dur WD : `#product-description` est un ÉLÉMENT HÔTE dont le contenu réel vit dans
	// un **Shadow DOM déclaratif** (`<template shadowrootmode="open">`), pas dans son
	// `innerHTML` light-DOM. Le navigateur consomme ce `<template>` à l'analyse de la page et
	// l'attache comme `element.shadowRoot` — cette encapsulation est PERMANENTE et n'a rien à
	// voir avec un délai de chargement : attendre plus longtemps (même 20s, testé en conditions
	// réelles) ne change rien, `document.querySelector('#product-description').innerHTML` reste
	// vide (`"<div></div>"` observé) indéfiniment, par construction du DOM. Seul
	// `element.shadowRoot.querySelector(...)` atteint ce contenu. `deepQuerySelectorAll()`
	// ci-dessous recherche donc chaque sélecteur à la fois dans le DOM normal ET dans tout
	// shadow root ouvert rencontré, récursivement. Le polling de `extractDescriptionHtml()` est
	// conservé comme filet de sécurité pour un éventuel VRAI cas de chargement différé ailleurs
	// sur le site, mais n'est plus le mécanisme qui résout ce bug précis.
	const DESCRIPTION_SELECTORS = [
		'#nav-description [class*="extend--content--"]',
		'.product-description',
		'[class*="detail-desc-decorate-richtext"]',
		'[class*="product-description"]',
		'[class*="description--content"]',
		'[class*="ProductDescription"]',
		'#description',
		'#Description',
		'#product-description',
	];

	// Repli spécifique iframe : si le conteneur ci-dessus est trouvé mais vide de texte réel
	// (cas confirmé le 2026-08-31), et qu'il contient un `<iframe>`, tente de lire son contenu —
	// ne fonctionne QUE si l'iframe est de même origine (contentDocument accessible). Si le
	// navigateur lève une erreur (iframe cross-origin), on l'attrape et on abandonne proprement :
	// pas de description dans ce cas, plutôt qu'une exception qui ferait planter toute
	// l'extraction (title/images/prix restent valides même si la description échoue).
	function inspectIframe( container ) {
		const iframe = container && container.querySelector && container.querySelector( 'iframe' );
		if ( ! iframe ) return { found: false, accessible: null, html: '', src: null, error: null };
		try {
			const doc = iframe.contentDocument;
			const html = doc && doc.body ? doc.body.innerHTML : '';
			return {
				found: true,
				accessible: !! doc,
				html: html && hasMeaningfulContent( html ) ? html : '',
				src: iframe.src || iframe.getAttribute( 'src' ) || null,
				error: null,
			};
		} catch ( e ) {
			return {
				found: true,
				accessible: false,
				html: '',
				src: iframe.src || iframe.getAttribute( 'src' ) || null,
				error: e && e.message ? e.message : String( e ),
			};
		}
	}

	function extractFromIframe( container ) {
		return inspectIframe( container ).html || '';
	}

	// Garde générale (pas seulement pour #product-description) : un conteneur peut exister et
	// avoir un innerHTML non vide tout en ne contenant AUCUN texte réel (ex. "<div></div>",
	// confirmé réel sur #product-description le 2026-08-31) — sans cette vérification, un tel
	// match "gagne" à tort et masque le bon conteneur suivant dans la liste.
	// Corrigé (2026-08-31, retour terrain) : une description AliExpress peut être presque
	// entièrement composée d'images avec très peu ou pas de texte — la version précédente de
	// cette fonction ne regardait que le texte une fois les balises retirées, et aurait donc
	// rejeté à tort une description légitime mais visuelle. Compte aussi la présence d'au moins
	// une <img> comme contenu significatif.
	function descriptionPlainText( html ) {
		return String( html || '' )
			.replace( /<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ' )
			.replace( /<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ' )
			.replace( /<[^>]*>/g, ' ' )
			.replace( /&nbsp;/gi, ' ' )
			.replace( /&amp;/gi, '&' )
			.replace( /\s+/g, ' ' )
			.trim();
	}

	function descriptionRejectReason( html ) {
		const text = descriptionPlainText( html ).toLowerCase();
		if ( ! text ) return '';
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
		for ( const re of blocked ) if ( re.test( text ) ) return re.source;
		return '';
	}

	function descriptionQuality( html ) {
		const raw = String( html || '' );
		const text = descriptionPlainText( raw );
		const imageCount = ( raw.match( /<img\b/gi ) || [] ).length;
		let score = 0;
		if ( text.length >= 120 ) score += 25;
		if ( text.length >= 300 ) score += 30;
		if ( text.length >= 900 ) score += 20;
		if ( imageCount >= 1 ) score += 15;
		if ( imageCount >= 3 ) score += 15;
		if ( /(?:detail-desc-decorate-richtext|detailmodule_html|product-description)/i.test( raw ) ) score += 35;
		if ( /(?:param(?:è|e)tre|caract(?:é|e)ristiques|specification|beschreibung|description|présentation)/i.test( text ) ) score += 15;
		if ( descriptionRejectReason( raw ) ) score -= 200;
		return { score, textLength: text.length, imageCount, rejectReason: descriptionRejectReason( raw ) };
	}

	function hasMeaningfulContent( html ) {
		const q = descriptionQuality( html );
		if ( q.rejectReason ) return false;
		return q.textLength > 0 || q.imageCount > 0;
	}

	function isTrustedDescriptionHtml( html, strict ) {
		const q = descriptionQuality( html );
		if ( q.rejectReason ) return false;
		return strict ? q.score >= 50 : ( q.textLength > 0 || q.imageCount > 0 );
	}

	function cleanDescriptionElementHtml( el ) {
		if ( ! el || typeof el.cloneNode !== 'function' ) return el && el.innerHTML ? el.innerHTML : '';
		let clone;
		try { clone = el.cloneNode( true ); } catch ( e ) { return el.innerHTML || ''; }
		try {
			for ( const node of Array.from( clone.querySelectorAll( 'script,style,template,iframe,noscript' ) ) ) node.remove();
			for ( const node of Array.from( clone.querySelectorAll( '*' ) ) ) {
				for ( const attr of Array.from( node.attributes || [] ) ) {
					const name = String( attr.name || '' ).toLowerCase();
					if ( name === 'class' || name === 'id' || name === 'style' || name.startsWith( 'data-' ) || name.startsWith( 'aria-' ) || name.startsWith( 'on' ) || name === 'slate-data-type' ) {
						node.removeAttribute( attr.name );
					}
				}
				if ( node.tagName && node.tagName.toLowerCase() === 'img' ) {
					const src = normalizeSupplierMediaUrl( node.getAttribute( 'src' ) || '' );
					if ( ! src ) { node.remove(); continue; }
					node.setAttribute( 'src', src );
					node.setAttribute( 'loading', 'lazy' );
				}
			}
		} catch ( e ) {}
		return clone.innerHTML || '';
	}

	function findPreferredDescriptionInNav() {
		const nav = findDescriptionNav();
		if ( ! nav ) return null;

		let host = null;
		try { host = nav.querySelector( '[data-pl="product-description"], #product-description' ); } catch ( e ) {}
		const roots = host ? getAllRoots( host ) : getAllRoots( nav );
		const preferredSelectors = [ '.detail-desc-decorate-richtext', '.detailmodule_html', '.product-description' ];
		for ( const selector of preferredSelectors ) {
			for ( const root of roots ) {
				let el = null;
				try { el = root.querySelector( selector ); } catch ( e ) {}
				if ( ! el ) continue;
				const html = cleanDescriptionElementHtml( el );
				const q = descriptionQuality( html );
				// This is the exact semantic description container inside #nav-description.
				// Accept visual-only descriptions too, while still rejecting cart/payment false positives.
				if ( q.textLength >= 80 || q.imageCount >= 1 ) {
					return {
						html, source: root === document ? 'dom_exact' : 'shadow_dom_exact', selector,
						shadowRootsFound: Math.max( 0, roots.length - 1 ), iframeFound: false, iframeAccessible: null, iframeError: null,
						descriptionScore: q.score, descriptionTextLength: q.textLength, descriptionImageCount: q.imageCount, rejectReason: null,
					};
				}
			}
		}
		return null;
	}

	// Confirmé empiriquement le 2026-08-31 (capture complète de page, fiche disque dur WD) :
	// AliExpress rend une partie de la fiche via Shadow DOM déclaratif
	// (`<template shadowrootmode="open">`), consommé par le navigateur à l'analyse du HTML et
	// attaché comme `element.shadowRoot` — INVISIBLE à `document.querySelector()` /
	// `.innerHTML` classiques, quel que soit le délai d'attente (encapsulation DOM standard, pas
	// un problème de chargement). `getAllRoots()` retourne la liste de tous les « racines »
	// interrogeables — `document` lui-même, plus chaque `shadowRoot` ouvert trouvé, y compris les
	// shadow roots imbriqués (un shadow root peut lui-même contenir des éléments avec leur propre
	// shadow root). Une racine "fermée" (`mode: 'closed'`) resterait invisible même à cette
	// fonction — aucune API JS ne permet d'y accéder de l'extérieur ; non rencontré sur
	// AliExpress à ce jour (tous les cas observés sont `mode: 'open'`).
	function getAllRoots( root, seen ) {
		const start = root || document;
		const visited = seen || new Set();
		const roots = [];

		function walk( current ) {
			if ( ! current || visited.has( current ) ) return;
			visited.add( current );
			roots.push( current );

			// Important sur les PDP AliExpress 2026 : le nœud transmis peut lui-même être
			// le host du Shadow DOM. L'ancienne version ne testait que ses descendants,
			// donc un shadowRoot attaché directement au host pouvait être manqué.
			try {
				if ( current.shadowRoot ) walk( current.shadowRoot );
			} catch ( e ) {}

			let all;
			try {
				all = current.querySelectorAll( '*' );
			} catch ( e ) {
				return; // DocumentFragment/racine partielle non interrogeable : pas fatal.
			}

			for ( const el of all ) {
				try {
					if ( el.shadowRoot ) walk( el.shadowRoot );
				} catch ( e ) {}

				// Fallback terrain 1005009587413681 : selon la manière dont AliExpress
				// hydrate la section, le declarative Shadow DOM peut encore être observable
				// sous forme de <template shadowrootmode="open"> au moment précis où le
				// content script lit le DOM. Dans ce cas, template.content est la seule
				// racine qui contient .detail-desc-decorate-richtext.
				try {
					const tag = String( el.tagName || '' ).toLowerCase();
					const mode = typeof el.getAttribute === 'function' ? String( el.getAttribute( 'shadowrootmode' ) || '' ).toLowerCase() : '';
					if ( tag === 'template' && mode === 'open' && el.content ) walk( el.content );
				} catch ( e ) {}
			}
		}

		walk( start );
		return roots;
	}

	// Une seule passe de lecture (synchrone) — utilisée à la fois pour le premier essai immédiat
	// et pour chaque tentative du polling ci-dessous. Cherche chaque sélecteur dans le DOM normal
	// ET dans tout shadow root ouvert (cf. getAllRoots ci-dessus) avant de passer au sélecteur
	// suivant — un sélecteur qui matche dans un shadow root est traité exactement comme un match
	// dans le DOM normal (même garde hasMeaningfulContent, même repli iframe).
	function tryReadDescriptionDetailed() {
		const preferred = findPreferredDescriptionInNav();
		if ( preferred ) return preferred;
		const roots = getAllRoots();
		let matchedSelector = null;
		let iframeFound = false;
		let iframeAccessible = null;
		let iframeError = null;

		for ( const selector of DESCRIPTION_SELECTORS ) {
			for ( let rootIndex = 0; rootIndex < roots.length; rootIndex++ ) {
				const searchRoot = roots[ rootIndex ];
				let el = null;
				try { el = searchRoot.querySelector( selector ); } catch ( e ) {}
				if ( ! el ) continue;
				if ( matchedSelector == null ) matchedSelector = selector;
				if ( el.innerHTML && hasMeaningfulContent( el.innerHTML ) ) {
					return {
						html: el.innerHTML,
						source: rootIndex === 0 ? 'dom' : 'shadow_dom',
						selector,
						shadowRootsFound: roots.length - 1,
						iframeFound, iframeAccessible, iframeError,
					};
				}
				const iframe = inspectIframe( el );
				if ( iframe.found ) {
					iframeFound = true; iframeAccessible = iframe.accessible; iframeError = iframe.error;
					if ( iframe.html ) {
						return {
							html: iframe.html, source: 'iframe', selector,
							shadowRootsFound: roots.length - 1,
							iframeFound: true, iframeAccessible: true, iframeError: null,
						};
					}
				}
			}
		}

		for ( let rootIndex = 0; rootIndex < roots.length; rootIndex++ ) {
			const searchRoot = roots[ rootIndex ];
			let navDescription = null;
			try { navDescription = searchRoot.querySelector( '#nav-description' ); } catch ( e ) {}
			if ( ! navDescription ) continue;
			const iframe = inspectIframe( navDescription );
			if ( iframe.found ) {
				iframeFound = true; iframeAccessible = iframe.accessible; iframeError = iframe.error;
				if ( iframe.html ) {
					return {
						html: iframe.html, source: 'iframe', selector: '#nav-description iframe',
						shadowRootsFound: roots.length - 1,
						iframeFound: true, iframeAccessible: true, iframeError: null,
					};
				}
			}
		}

		return {
			html: '', source: null, selector: matchedSelector, shadowRootsFound: roots.length - 1,
			iframeFound, iframeAccessible, iframeError,
		};
	}

	function tryReadDescriptionOnce() {
		return tryReadDescriptionDetailed().html || '';
	}

	function findDescriptionNav() {
		for ( const root of getAllRoots() ) {
			try {
				const nav = root.querySelector( '#nav-description' );
				if ( nav ) return nav;
			} catch ( e ) {}
		}
		return null;
	}

	// Cause réelle confirmée le 2026-08-31 (prise 2, capture complète de page) : la vraie cause
	// du conteneur vide était le Shadow DOM (cf. commentaire de `getAllRoots()` ci-dessus),
	// PAS un délai de chargement — corrigé par `tryReadDescriptionOnce()` qui cherche maintenant
	// à l'intérieur des shadow roots ouverts. Ce polling est conservé quand même comme filet de
	// sécurité générique (un vrai cas de contenu qui se peuple après coup, ailleurs sur le site,
	// resterait couvert) — mais dans le cas précis diagnostiqué ici, le contenu est présent dès
	// le premier essai une fois le shadow DOM pris en compte ; ce n'est plus le polling qui
	// "corrige" le problème. Sans cliquer ni déclencher aucune requête réseau (toujours conforme
	// à la contrainte "aucun clic simulé" du §6.2). `maxWaitMs`/`intervalMs` réglables pour les
	// tests (attente courte en jsdom).
	// Troisième cause distincte trouvée pour une description vide, confirmée le 2026-08-31 (fiche
	// « spot LED », item/1005009587413681.html, inspectée directement — pas un script à faire
	// coller à Soufiane) : contrairement au cas Shadow DOM déclaratif déjà corrigé (présent dès
	// l'analyse du HTML), ici le shadow root n'existe PAS DU TOUT tant que la section n'a jamais
	// été visible à l'écran — confirmé en observant `getAllRoots()` passer de 0 à 1 shadow root
	// juste après avoir fait défiler la page jusqu'à `#nav-description`, sans rien d'autre changé
	// (rendu paresseux côté AliExpress, probablement un IntersectionObserver). Ni un problème de
	// sélecteur, ni un vrai délai réseau : le contenu n'est simplement créé par AliExpress que si
	// la section entre dans le viewport.
	//
	// `nav.scrollIntoView()` ci-dessous n'est PAS une contravention à la contrainte "aucun clic
	// simulé, aucune requête déclenchée" du §2/§6.2 : ce n'est ni un clic, ni un appel réseau
	// initié par ce script — un simple défilement de page, geste qu'un visiteur humain fait
	// normalement en lisant une fiche produit. La position de défilement d'origine de l'onglet
	// AliExpress est restaurée une fois l'extraction terminée (succès ou abandon), pour ne pas
	// perturber la navigation de l'utilisateur qui a cet onglet ouvert.
	let preparedDescriptionResult = null;

	async function waitForDescriptionAnchor( maxWaitMs ) {
		const deadline = Date.now() + ( maxWaitMs == null ? 2500 : Math.max( 0, Number( maxWaitMs ) || 0 ) );
		let nav = findDescriptionNav();
		while ( ! nav && Date.now() < deadline ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 120 ) );
			nav = findDescriptionNav();
		}
		return nav;
	}

	async function prepareDescriptionForEditor( maxWaitMs, intervalMs ) {
		// Important : cette étape est appelée AVANT l'ouverture de l'onglet éditeur, tant que
		// la fiche AliExpress est encore l'onglet actif. Les PDP AliExpress 2026 ne construisent
		// le Shadow DOM de #nav-description qu'après entrée de cette section dans le viewport.
		await waitForDescriptionAnchor( 2500 );
		preparedDescriptionResult = await extractDescriptionResult( maxWaitMs == null ? 8000 : maxWaitMs, intervalMs == null ? 200 : intervalMs );
		return preparedDescriptionResult;
	}

	function extractDescriptionResult( maxWaitMs, intervalMs ) {
		const startedAt = Date.now();
		const deadline = startedAt + ( maxWaitMs == null ? 8000 : maxWaitMs );
		const step = intervalMs == null ? 400 : intervalMs;
		const nav = findDescriptionNav();
		const originalScrollY = nav ? window.scrollY : null;
		let scrollAttempted = false;
		let attempts = 0;

		if ( nav && typeof nav.scrollIntoView === 'function' ) {
			try {
				nav.scrollIntoView( { block: 'center', behavior: 'auto' } );
				scrollAttempted = true;
			} catch ( e ) {}
		}

		return new Promise( ( resolve ) => {
			function finish( read, timedOut ) {
				if ( nav && originalScrollY != null && typeof window.scrollTo === 'function' ) {
					try { window.scrollTo( 0, originalScrollY ); } catch ( e ) {}
				}
				const hasHtml = !! ( read && read.html );
				let status = 'not_found';
				if ( hasHtml ) status = 'extracted';
				else if ( read && read.iframeFound && read.iframeAccessible === false ) status = 'iframe_inaccessible';
				else if ( timedOut && ( nav || ( read && read.selector ) || ( read && read.shadowRootsFound > 0 ) ) ) status = 'timeout';
				resolve( {
					html: hasHtml ? read.html : '',
					status,
					diagnostics: {
						source: read && read.source || null,
						matchedSelector: read && read.selector || null,
						shadowRootsFound: read && Number( read.shadowRootsFound || 0 ) || 0,
						iframeFound: !! ( read && read.iframeFound ),
						iframeAccessible: read ? read.iframeAccessible : null,
						iframeError: read && read.iframeError || null,
						descriptionScore: read && read.descriptionScore != null ? read.descriptionScore : ( hasHtml ? descriptionQuality( read.html ).score : null ),
						descriptionTextLength: read && read.descriptionTextLength != null ? read.descriptionTextLength : ( hasHtml ? descriptionQuality( read.html ).textLength : 0 ),
						descriptionImageCount: read && read.descriptionImageCount != null ? read.descriptionImageCount : ( hasHtml ? descriptionQuality( read.html ).imageCount : 0 ),
						rejectReason: read && read.rejectReason || null,
						navFound: !! nav,
						scrollAttempted,
						attempts,
						elapsedMs: Date.now() - startedAt,
					},
				} );
			}

			function attempt() {
				attempts++;
				const read = tryReadDescriptionDetailed();
				if ( read.html ) { finish( read, false ); return; }
				if ( Date.now() >= deadline ) { finish( read, true ); return; }
				setTimeout( attempt, step );
			}
			attempt();
		} );
	}

	async function extractDescriptionHtml( maxWaitMs, intervalMs ) {
		return ( await extractDescriptionResult( maxWaitMs, intervalMs ) ).html;
	}


	// Aide au diagnostic (2026-08-31, description vide sur une vraie fiche testée) : AliExpress a
	// par le passé chargé la description dans un <iframe> pointant vers un autre domaine — dans
	// ce cas un content script ne peut PAS lire son contenu (restriction cross-origin du
	// navigateur, pas un bug de sélecteur). `CDH.debugDescription()` le distingue explicitement,
	// pour ne pas chercher indéfiniment le bon sélecteur si le vrai problème est ailleurs.
	function debugDescription() {
		const read = tryReadDescriptionDetailed();
		const quality = read.html ? descriptionQuality( read.html ) : { score: 0, textLength: 0, imageCount: 0, rejectReason: null };
		return {
			matchedSelector: read.selector || null,
			shadowRootsFound: Number( read.shadowRootsFound || 0 ),
			source: read.source || null,
			hasMeaningfulContent: !! read.html,
			descriptionScore: read.descriptionScore != null ? read.descriptionScore : quality.score,
			textLength: read.descriptionTextLength != null ? read.descriptionTextLength : quality.textLength,
			imageCount: read.descriptionImageCount != null ? read.descriptionImageCount : quality.imageCount,
			rejectReason: read.rejectReason || quality.rejectReason || null,
			iframeFound: !! read.iframeFound,
			iframeAccessible: read.iframeAccessible,
			iframeError: read.iframeError || null,
			navFound: !! findDescriptionNav(),
		};
	}


	// Diagnostic dédié (2026-08-31) : l'iframe de description trouvée sur une vraie fiche n'a
	// pas de `src` visible dans le HTML statique — reste à savoir si le navigateur peut quand
	// même lire son contenu (même origine / rempli en JS) ou si c'est bloqué (cross-origin réel).
	function debugIframe() {
		const nav = findDescriptionNav();
		if ( ! nav ) return { found: false };
		const info = inspectIframe( nav );
		if ( ! info.found ) return { found: false };
		return {
			found: true,
			src: info.src,
			sameOriginAccessible: info.accessible,
			bodyPreview: info.html ? info.html.slice( 0, 500 ) : null,
			errorMessage: info.error,
		};
	}



	// ---------------------------------------------------------------------
	// 4. Caractéristiques produit / fournisseur
	// ---------------------------------------------------------------------
	function cleanText( value ) {
		return String( value || '' ).replace( /\u00a0/g, ' ' ).replace( /\s+/g, ' ' ).trim();
	}

	function normalizeSpecificationLabel( label ) {
		const source = cleanText( label );
		const key = source.toLowerCase().replace( /[’']/g, "'" );
		const map = {
			'terminer': 'Finition',
			'utiliser': 'Utilisation',
			"type d'article": 'Type d’article',
			'est à intensité variable': 'Intensité variable',
			'les ampoules sont-elles incluses': 'Ampoules incluses',
			'nom de marque': 'Marque',
			'méthode d’installation': 'Méthode d’installation',
			'methode d’installation': 'Méthode d’installation',
			'source de lumière': 'Source de lumière',
			'source d’énergie': 'Source d’énergie',
			'source d\'énergie': 'Source d’énergie',
		};
		return map[ key ] || source;
	}

	function normalizeSpecificationValue( value ) {
		const source = cleanText( value );
		const lower = source.toLowerCase();
		if ( lower === 'no' ) return 'Non';
		if ( lower === 'yes' ) return 'Oui';
		const years = lower.match( /^(\d+)\s+years?$/ );
		if ( years ) return `${ years[1] } an${ years[1] === '1' ? '' : 's' }`;
		return source;
	}

	function isUsefulSpecificationPair( label, value ) {
		label = cleanText( label ); value = cleanText( value );
		if ( ! label || ! value || label === value ) return false;
		if ( label.length > 90 || value.length > 500 ) return false;
		if ( /^(détails|details|spécifications|specifications|caractéristiques)$/i.test( label ) ) return false;
		return true;
	}

	function pairsFromRow( row ) {
		let cells = Array.from( row.querySelectorAll( ':scope > th, :scope > td' ) );
		if ( ! cells.length ) cells = Array.from( row.children || [] );
		const texts = cells.map( ( cell ) => cleanText( cell.innerText || cell.textContent ) ).filter( Boolean );
		if ( texts.length < 2 || texts.length > 6 ) return [];
		const pairs = [];
		for ( let i = 0; i + 1 < texts.length; i += 2 ) {
			if ( isUsefulSpecificationPair( texts[i], texts[i + 1] ) ) pairs.push( [ texts[i], texts[i + 1] ] );
		}
		return pairs;
	}

	function extractSpecificationsOnce() {
		const roots = getAllRoots();
		const containers = [];
		const seenContainers = new Set();
		const selectors = [
			'#nav-specification', '#product-specification',
			'[class*="specification--content--"]', '[class*="specification--wrap--"]',
			'[class*="product-specification"]', '[class*="specification"]'
		];
		for ( const rootNode of roots ) {
			for ( const selector of selectors ) {
				let nodes = [];
				try { nodes = Array.from( rootNode.querySelectorAll( selector ) ); } catch ( e ) {}
				for ( const node of nodes ) {
					if ( seenContainers.has( node ) ) continue;
					const text = cleanText( node.innerText || node.textContent );
					if ( ! text || text.length < 10 ) continue;
					seenContainers.add( node ); containers.push( node );
				}
			}
		}

		const pairs = [];
		const seenPairs = new Set();
		function pushPair( label, value ) {
			label = cleanText( label ); value = cleanText( value );
			if ( ! isUsefulSpecificationPair( label, value ) ) return;
			const fingerprint = `${ label.toLowerCase() }\u0000${ value.toLowerCase() }`;
			if ( seenPairs.has( fingerprint ) ) return;
			seenPairs.add( fingerprint );
			pairs.push( {
				source_label: label,
				source_value: value,
				name: normalizeSpecificationLabel( label ),
				value: normalizeSpecificationValue( value ),
			} );
		}

		for ( const container of containers ) {
			// HTML tables, including the 4-column "label/value + label/value" layout.
			for ( const row of container.querySelectorAll( 'tr' ) ) {
				for ( const pair of pairsFromRow( row ) ) pushPair( pair[0], pair[1] );
			}
			// Definition lists.
			for ( const dt of container.querySelectorAll( 'dt' ) ) {
				const dd = dt.nextElementSibling;
				if ( dd && dd.tagName && dd.tagName.toLowerCase() === 'dd' ) pushPair( dt.textContent, dd.textContent );
			}
			// AliExpress frequently renders specifications as CSS-module rows rather than <table>.
			const rowSelectors = [
				'[class*="specification--prop--"]', '[class*="specification--item--"]',
				'[class*="specification--row--"]', '[class*="specification--line--"]',
				'[class*="specification--property--"]'
			];
			for ( const selector of rowSelectors ) {
				for ( const row of container.querySelectorAll( selector ) ) {
					for ( const pair of pairsFromRow( row ) ) pushPair( pair[0], pair[1] );
				}
			}
			// Generic direct-child fallback for grid rows with 2 or 4 cells.
			for ( const row of container.querySelectorAll( 'div' ) ) {
				if ( ! row.children || ( row.children.length !== 2 && row.children.length !== 4 ) ) continue;
				const text = cleanText( row.innerText || row.textContent );
				if ( ! text || text.length > 900 ) continue;
				for ( const pair of pairsFromRow( row ) ) pushPair( pair[0], pair[1] );
			}
		}
		return pairs;
	}

	async function extractSpecifications( maxWaitMs ) {
		const nav = document.querySelector( '#nav-specification' );
		const originalScrollY = nav ? window.scrollY : null;
		if ( nav && typeof nav.scrollIntoView === 'function' ) {
			try { nav.scrollIntoView( { block: 'center', behavior: 'auto' } ); } catch ( e ) {}
		}
		const deadline = Date.now() + ( maxWaitMs == null ? 3500 : maxWaitMs );
		let result = [];
		do {
			result = extractSpecificationsOnce();
			if ( result.length ) break;
			await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );
		} while ( Date.now() < deadline );
		if ( nav && originalScrollY != null && typeof window.scrollTo === 'function' ) {
			try { window.scrollTo( 0, originalScrollY ); } catch ( e ) {}
		}
		return result;
	}


	// ---------------------------------------------------------------------
	// 3.4 Documents fournisseur + guide des tailles
	// ---------------------------------------------------------------------
	function documentTypeFromLabel( raw ) {
		const label = cleanText( raw ).toLowerCase();
		if ( /mode d['’]emploi|user manual|manual|manuel/.test( label ) ) return 'manual';
		if ( /guide d['’]installation|installation guide/.test( label ) ) return 'installation_guide';
		if ( /fiche technique|data ?sheet|datasheet/.test( label ) ) return 'datasheet';
		if ( /certificat|certificate/.test( label ) ) return 'certificate';
		return 'other';
	}

	function extractSupplierDocuments() {
		const out = [];
		const seen = new Set();
		for ( const rootNode of getAllRoots() ) {
			let links = [];
			try { links = Array.from( rootNode.querySelectorAll( 'a[href]' ) ); } catch ( e ) {}
			for ( const link of links ) {
				const href = String( link.href || link.getAttribute( 'href' ) || '' ).trim();
				if ( ! /^https:\/\//i.test( href ) || ! /\.pdf(?:[?#]|$)/i.test( href ) ) continue;
				let url;
				try { url = new URL( href ); } catch ( e ) { continue; }
				if ( ! /(?:aliexpress|alicdn|aliexpress-media)\./i.test( url.hostname ) && ! /aliexpress/i.test( url.hostname ) ) continue;
				const rawText = cleanText( link.innerText || link.textContent || link.getAttribute( 'title' ) || '' );
				const title = cleanText( rawText.replace( /(?:^|\s)(?:voir|view|ouvrir|open)(?:\s|$)/gi, ' ' ) ) || 'Document produit';
				const key = url.origin + url.pathname;
				if ( seen.has( key ) ) continue;
				seen.add( key );
				const fileParam = url.searchParams.get( 'file' );
				const filename = cleanText( fileParam || url.pathname.split( '/' ).pop() || 'document.pdf' ).replace( /[^\w.()\- ]+/g, '-' );
				out.push( {
					type: documentTypeFromLabel( title ),
					title,
					source_url: url.href,
					canonical_url: url.origin + url.pathname,
					filename: /\.pdf$/i.test( filename ) ? filename : filename + '.pdf',
					mime_type: 'application/pdf',
					language: document.documentElement.lang || '',
					source: 'aliexpress',
				} );
			}
		}
		return out;
	}

	function findSizeGuideProperty() {
		const candidates = [];
		for ( const rootNode of getAllRoots() ) {
			let nodes = [];
			try { nodes = Array.from( rootNode.querySelectorAll( 'span,button,a,div' ) ); } catch ( e ) {}
			for ( const node of nodes ) {
				const text = cleanText( node.textContent || '' );
				if ( ! /^(?:guide des tailles|size guide|guía de tallas|größentabelle)$/i.test( text ) ) continue;
				let current = node;
				for ( let depth = 0; current && depth < 7; depth++, current = current.parentElement ) {
					if ( current.querySelector && current.querySelector( '[data-sku-row]' ) ) { candidates.push( current ); break; }
				}
			}
		}
		return candidates[0] || null;
	}

	function parseSizeMeasurement( rawName, rawValue ) {
		const labelRaw = cleanText( rawName ).replace( /\s*:\s*$/, '' );
		const valueRaw = cleanText( rawValue );
		if ( ! labelRaw || ! valueRaw ) return null;
		const unitHintMatch = labelRaw.match( /\((kg|g|lb|lbs|cm|mm|m|in|inch|inches)\)\s*$/i );
		const unitHint = unitHintMatch ? String( unitHintMatch[1] || '' ).toLowerCase() : '';
		const name = unitHintMatch ? cleanText( labelRaw.slice( 0, unitHintMatch.index ) ) : labelRaw;
		const normalized = valueRaw.replace( /[–—−]/g, '-' );
		const range = normalized.match( /^\s*([\d.,]+)\s*-\s*([\d.,]+)\s*([a-zA-Z]+)?\s*$/ );
		const single = normalized.match( /^\s*([\d.,]+)\s*([a-zA-Z]+)?\s*$/ );
		let valueType = 'text', value = valueRaw, min = null, max = null, rawUnit = '';
		if ( range ) {
			valueType = 'range'; min = Number( range[1].replace( ',', '.' ) ); max = Number( range[2].replace( ',', '.' ) ); rawUnit = String( range[3] || '' ).toLowerCase(); value = null;
		} else if ( single ) {
			valueType = 'single'; value = Number( single[1].replace( ',', '.' ) ); rawUnit = String( single[2] || '' ).toLowerCase();
		}
		const unit = unitHint || rawUnit;
		const unitConflict = !! ( unitHint && rawUnit && unitHint !== rawUnit );
		return {
			name, value_type: valueType, value, min, max, unit, raw_value: valueRaw, raw_unit: rawUnit,
			unit_source: unitHint ? 'label' : ( rawUnit ? 'value' : '' ), unit_conflict: unitConflict, source: 'aliexpress',
			supplier_value: valueType === 'single' ? value : null, supplier_min: valueType === 'range' ? min : null, supplier_max: valueType === 'range' ? max : null,
			supplier_unit: unit, supplier_raw_value: valueRaw, manual_updated_at: ''
		};
	}

	function readSizeMeasurements( property ) {
		const rows = [];
		if ( ! property || ! property.querySelectorAll ) return rows;
		let items = [];
		try { items = Array.from( property.querySelectorAll( '[class*="sizeInfoItem"]' ) ); } catch ( e ) {}
		for ( const item of items ) {
			const spans = Array.from( item.querySelectorAll( 'span' ) ).map( ( el ) => cleanText( el.textContent || '' ) ).filter( Boolean );
			if ( spans.length < 2 ) continue;
			const measurement = parseSizeMeasurement( spans[0], spans.slice( 1 ).join( ' ' ) );
			if ( measurement ) rows.push( measurement );
		}
		return rows;
	}

	function selectedSkuNode( row ) {
		if ( ! row ) return null;
		const nodes = Array.from( row.querySelectorAll( '[data-sku-col]' ) );
		return nodes.find( ( node ) => /selected/i.test( String( node.className || '' ) ) || node.getAttribute( 'aria-selected' ) === 'true' ) || null;
	}

	async function waitForSizeMeasurements( property, row, option, maxWaitMs ) {
		const deadline = Date.now() + Math.max( 120, Number( maxWaitMs ) || 650 );
		let last = [];
		do {
			last = readSizeMeasurements( property );
			const selected = selectedSkuNode( row );
			if ( last.length && ( ! option || selected === option ) ) return last;
			await new Promise( ( resolve ) => setTimeout( resolve, 70 ) );
		} while ( Date.now() < deadline );
		return last;
	}

	async function extractSizeGuide() {
		const property = findSizeGuideProperty();
		if ( ! property ) return null;
		const row = property.querySelector( '[data-sku-row]' );
		if ( ! row ) return null;
		const options = Array.from( row.querySelectorAll( '[data-sku-col]' ) );
		if ( ! options.length ) return null;
		const labels = options.map( ( node ) => cleanText( node.getAttribute( 'title' ) || node.getAttribute( 'aria-label' ) || node.textContent || '' ) ).filter( Boolean );
		const sourceAttribute = guessDimensionLabel( row, labels.map( ( value ) => value.toLowerCase() ) ) || 'Taille';
		const rowId = String( row.getAttribute( 'data-sku-row' ) || ( options[0].getAttribute( 'data-sku-col' ) || '' ).split( '-' )[0] || '' );
		const original = selectedSkuNode( row );
		const sizes = [];
		for ( const option of options.slice( 0, 30 ) ) {
			const col = String( option.getAttribute( 'data-sku-col' ) || '' );
			const valueId = col.includes( '-' ) ? col.slice( col.indexOf( '-' ) + 1 ) : '';
			const label = cleanText( option.getAttribute( 'title' ) || option.getAttribute( 'aria-label' ) || option.textContent || '' );
			if ( ! label ) continue;
			if ( option !== selectedSkuNode( row ) ) {
				try { option.click(); } catch ( e ) {}
			}
			const measurements = await waitForSizeMeasurements( property, row, option, 720 );
			sizes.push( { source_value: label, source_value_id: valueId, measurements } );
		}
		if ( original && original !== selectedSkuNode( row ) ) { try { original.click(); } catch ( e ) {} }
		const detectedUnits = new Set();
		for ( const size of sizes ) for ( const m of size.measurements || [] ) if ( m.unit ) detectedUnits.add( String( m.unit ) );
		return {
			source_attribute: sourceAttribute,
			source_property_id: rowId,
			unit: detectedUnits.size === 1 ? Array.from( detectedUnits )[0] : '',
			sizes,
			observed_at: new Date().toISOString(),
		};
	}


	// ---------------------------------------------------------------------
	// 3.6 Livraison fournisseur courante
	// ---------------------------------------------------------------------
	// AliExpress expose souvent le coût courant directement dans le DOM, par ex.
	// "Livraison: CHF2.89" puis "Livraison : sep. 10 - 18". Les classes CSS
	// hashées ne sont pas utilisées comme contrat : on s'appuie sur le texte et
	// sur le conteneur dynamique stable lorsqu'il existe.
	function parseSupplierMoneyText( raw, fallbackCurrency ) {
		const text = cleanText( raw );
		if ( ! text ) return { known: false, amount: null, currency: String( fallbackCurrency || '' ).toUpperCase(), is_free: false };
		if ( /\b(?:livraison gratuite|free shipping|versandkostenfrei|env[ií]o gratis)\b/i.test( text ) ) {
			return { known: true, amount: 0, currency: String( fallbackCurrency || '' ).toUpperCase(), is_free: true };
		}
		const currencyMatch = text.match( /\b(CHF|USD|EUR|GBP|CAD|AUD|JPY|CNY|RMB)\s*([\d\s.,]+)/i ) || text.match( /([€$£])\s*([\d\s.,]+)/ );
		if ( ! currencyMatch ) return { known: false, amount: null, currency: String( fallbackCurrency || '' ).toUpperCase(), is_free: false };
		const symbol = currencyMatch[1];
		let currency = String( symbol || '' ).toUpperCase();
		if ( symbol === '€' ) currency = 'EUR'; else if ( symbol === '£' ) currency = 'GBP'; else if ( symbol === '$' ) currency = String( fallbackCurrency || 'USD' ).toUpperCase();
		const numeric = String( currencyMatch[2] || '' ).replace( /\s+/g, '' ).replace( /,(?=\d{1,2}$)/, '.' ).replace( /,/g, '' );
		const amount = Number.parseFloat( numeric );
		return Number.isFinite( amount ) ? { known: true, amount, currency, is_free: amount === 0 } : { known: false, amount: null, currency, is_free: false };
	}

	function shippingMonthIndex( raw ) {
		const key = String( raw || '' ).toLowerCase().normalize( 'NFD' ).replace( /[\u0300-\u036f]/g, '' ).replace( /\./g, '' );
		const months = {
			jan:0, january:0, janvier:0, januar:0, enero:0,
			feb:1, february:1, fevrier:1, februar:1, febrero:1,
			mar:2, march:2, mars:2, marz:2, marzo:2,
			apr:3, april:3, avril:3, abril:3,
			may:4, mai:4, mayo:4,
			jun:5, june:5, juin:5, juni:5, junio:5,
			jul:6, july:6, juillet:6, juli:6, julio:6,
			aug:7, august:7, aout:7, agosto:7,
			sep:8, sept:8, september:8, septembre:8, septiembre:8,
			oct:9, october:9, octobre:9, oktober:9, octubre:9,
			nov:10, november:10, novembre:10, noviembre:10,
			dec:11, december:11, decembre:11, dezember:11, diciembre:11,
		};
		return Object.prototype.hasOwnProperty.call( months, key ) ? months[key] : null;
	}

	function isoLocalDate( date ) {
		const y = date.getFullYear(); const m = String( date.getMonth() + 1 ).padStart( 2, '0' ); const d = String( date.getDate() ).padStart( 2, '0' );
		return `${ y }-${ m }-${ d }`;
	}

	function dayDiff( from, to ) {
		const a = Date.UTC( from.getFullYear(), from.getMonth(), from.getDate() );
		const b = Date.UTC( to.getFullYear(), to.getMonth(), to.getDate() );
		return Math.round( ( b - a ) / 86400000 );
	}

	function inferDeliveryDate( month, day, now ) {
		let year = now.getFullYear();
		let candidate = new Date( year, month, day, 12, 0, 0 );
		if ( dayDiff( now, candidate ) < -45 ) candidate = new Date( year + 1, month, day, 12, 0, 0 );
		return candidate;
	}

	function parseDeliveryWindow( raw, nowValue ) {
		const text = cleanText( raw );
		if ( ! text ) return { delivery_date_start: '', delivery_date_end: '', delivery_min_days: null, delivery_max_days: null };
		const now = nowValue instanceof Date ? nowValue : new Date();
		const monthToken = '(jan(?:v(?:ier)?)?|feb(?:ruary)?|f[eé]v(?:rier)?|mar(?:ch|s|zo)?|apr(?:il)?|avr(?:il)?|may|mai|mayo|jun(?:e|i|io)?|juil(?:let)?|jul(?:y|io)?|aug(?:ust)?|ao[uû]t|agosto|sep(?:t(?:ember|embre|iembre)?)?|oct(?:ober|obre)?|oktober|nov(?:ember|embre|iembre)?|dec(?:ember)?|d[eé]c(?:embre)?|dezember|diciembre)\\.?';
		let match = text.match( new RegExp( monthToken + '\\s*(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})', 'i' ) );
		let month, startDay, endDay;
		if ( match ) { month = shippingMonthIndex( match[1] ); startDay = Number( match[2] ); endDay = Number( match[3] ); }
		if ( month == null ) {
			match = text.match( new RegExp( '(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})\\s*' + monthToken, 'i' ) );
			if ( match ) { startDay = Number( match[1] ); endDay = Number( match[2] ); month = shippingMonthIndex( match[3] ); }
		}
		if ( month == null || ! startDay || ! endDay ) return { delivery_date_start: '', delivery_date_end: '', delivery_min_days: null, delivery_max_days: null };
		const start = inferDeliveryDate( month, startDay, now );
		let end = inferDeliveryDate( month, endDay, now );
		if ( end < start ) end = new Date( start.getFullYear(), start.getMonth() + 1, endDay, 12, 0, 0 );
		return { delivery_date_start: isoLocalDate( start ), delivery_date_end: isoLocalDate( end ), delivery_min_days: Math.max( 0, dayDiff( now, start ) ), delivery_max_days: Math.max( 0, dayDiff( now, end ) ) };
	}

	function selectedSkuAttributesForShipping() {
		const out = []; const seenRows = new Set();
		for ( const rootNode of getAllRoots() ) {
			let rows = [];
			try { rows = Array.from( rootNode.querySelectorAll( '[data-sku-row]' ) ); } catch ( e ) {}
			for ( const row of rows ) {
				const propertyId = String( row.getAttribute( 'data-sku-row' ) || '' );
				if ( propertyId && seenRows.has( propertyId ) ) continue;
				const selected = selectedSkuNode( row ); if ( ! selected ) continue;
				const col = String( selected.getAttribute( 'data-sku-col' ) || '' );
				const valueId = col.includes( '-' ) ? col.slice( col.indexOf( '-' ) + 1 ) : '';
				const value = cleanText( selected.getAttribute( 'title' ) || selected.getAttribute( 'aria-label' ) || selected.textContent || '' );
				if ( ! valueId && ! value ) continue;
				out.push( { property_id: propertyId, value_id: valueId, value } ); if ( propertyId ) seenRows.add( propertyId );
			}
		}
		return out;
	}

	function supplierSkuForSelectedAttributes( skuData, selected ) {
		const wanted = Array.isArray( selected ) ? selected.filter( ( item ) => item && ( item.value_id || item.value ) ) : [];
		if ( ! wanted.length ) return null;
		const matches = ( Array.isArray( skuData && skuData.combinations ) ? skuData.combinations : [] ).filter( ( combo ) => wanted.every( ( w ) => ( Array.isArray( combo && combo.attributes ) ? combo.attributes : [] ).some( ( attr ) => {
			if ( w.property_id && attr && attr.property_id && String( attr.property_id ) !== String( w.property_id ) ) return false;
			if ( w.value_id && attr && attr.value_id ) return String( attr.value_id ) === String( w.value_id );
			return !! w.value && cleanText( attr && attr.value || '' ).toLowerCase() === cleanText( w.value ).toLowerCase();
		} ) ) );
		return matches.length === 1 ? matches[0] : null;
	}

	function extractCurrentShipping( skuData, fallbackCurrency ) {
		const candidates = [];
		for ( const rootNode of getAllRoots() ) {
			let nodes = [];
			try { nodes = Array.from( rootNode.querySelectorAll( '.dynamic-shipping, [class*="dynamic-shipping"]' ) ); } catch ( e ) {}
			for ( const node of nodes ) if ( node && ! candidates.includes( node ) ) candidates.push( node );
		}
		for ( const node of candidates ) {
			const fullText = cleanText( node.innerText || node.textContent || '' );
			if ( ! /(?:livraison|shipping|versand|env[ií]o)/i.test( fullText ) ) continue;
			let lines = [];
			try { lines = Array.from( node.querySelectorAll( 'strong,span,div' ) ).map( ( el ) => cleanText( el.textContent || '' ) ).filter( ( text ) => text && text.length <= 180 ); } catch ( e ) {}
			lines.unshift( fullText ); lines = Array.from( new Set( lines ) );
			let money = { known: false, amount: null, currency: String( fallbackCurrency || '' ).toUpperCase(), is_free: false };
			let feeText = '';
			for ( const line of lines ) { const parsed = parseSupplierMoneyText( line, fallbackCurrency ); if ( parsed.known ) { money = parsed; feeText = line; break; } }
			let deliveryText = ''; let delivery = { delivery_date_start: '', delivery_date_end: '', delivery_min_days: null, delivery_max_days: null };
			for ( const line of lines ) { const parsed = parseDeliveryWindow( line ); if ( parsed.delivery_min_days != null ) { deliveryText = line; delivery = parsed; break; } }
			if ( ! money.known && delivery.delivery_min_days == null ) continue;
			const selectedAttributes = selectedSkuAttributesForShipping();
			const selectedSku = supplierSkuForSelectedAttributes( skuData, selectedAttributes );
			const referencePrice = selectedSku && selectedSku.supplier_price && Number( selectedSku.supplier_price.amount ) > 0 ? Number( selectedSku.supplier_price.amount ) : null;
			return {
				fee: money.known ? money.amount : null,
				fee_known: !! money.known,
				currency: money.currency || String( fallbackCurrency || '' ).toUpperCase(),
				is_free_shipping: !! ( money.known && money.amount === 0 ),
				method: '',
				delivery_text: deliveryText,
				fee_text: feeText,
				delivery_date_start: delivery.delivery_date_start,
				delivery_date_end: delivery.delivery_date_end,
				delivery_min_days: delivery.delivery_min_days,
				delivery_max_days: delivery.delivery_max_days,
				destination_country: '',
				quantity: 1,
				scope: 'current_selection',
				selected_attributes: selectedAttributes,
				supplier_sku_id: selectedSku ? String( selectedSku.supplier_sku_id || '' ) : '',
				reference_supplier_price: referencePrice,
				source: 'aliexpress_dom',
				observed_at: new Date().toISOString(),
			};
		}
		return null;
	}

	function extractSupplier( product ) {
		let seller = null;
		const offers = product && product.offers ? ( Array.isArray( product.offers ) ? product.offers : [ product.offers ] ) : [];
		for ( const offer of offers ) {
			if ( offer && offer.seller ) { seller = offer.seller; break; }
		}
		if ( ! seller && product && product.seller ) seller = product.seller;

		let storeName = seller && typeof seller === 'object' ? cleanText( seller.name || seller.legalName || '' ) : cleanText( seller || '' );
		let storeUrl = seller && typeof seller === 'object' ? cleanText( seller.url || seller['@id'] || '' ) : '';
		let sellerId = '';

		const storeLinks = Array.from( document.querySelectorAll( 'a[href*="/store/"], a[href*="store.aliexpress"], a[href*="seller"]' ) );
		let bestLink = null;
		for ( const link of storeLinks ) {
			const text = cleanText( link.innerText || link.textContent || link.getAttribute( 'title' ) );
			if ( ! text || text.length > 100 ) continue;
			if ( ! bestLink || /store|boutique|shop/i.test( text ) ) bestLink = link;
			if ( /official store|store|boutique/i.test( text ) ) break;
		}
		if ( bestLink ) {
			if ( ! storeName ) storeName = cleanText( bestLink.innerText || bestLink.textContent || bestLink.getAttribute( 'title' ) );
			if ( ! storeUrl ) storeUrl = bestLink.href || bestLink.getAttribute( 'href' ) || '';
		}
		if ( storeUrl ) {
			const idMatch = String( storeUrl ).match( /\/store\/(\d+)/i ) || String( storeUrl ).match( /(?:sellerId|seller_id|storeId|store_id)=(\d+)/i );
			if ( idMatch ) sellerId = idMatch[1];
		}

		const pageText = cleanText( document.body && ( document.body.innerText || document.body.textContent ) );
		const soldMatch = pageText.match( /\b([\d\s.,]+)\s*(?:vendus?|sold)\b/i );
		return {
			store_name: storeName || '',
			store_url: storeUrl || '',
			seller_id: sellerId || '',
			sold_count_text: soldMatch ? cleanText( soldMatch[1] ) : '',
			observed_at: new Date().toISOString(),
		};
	}


	// ---------------------------------------------------------------------
	// 3.5 SKU réels / prix fournisseur par combinaison
	// ---------------------------------------------------------------------
	// Le content script s'exécute dans un monde isolé et ne peut pas lire directement les
	// variables JavaScript de la page AliExpress. `page-sku-bridge.js`, chargé en MAIN world,
	// expose uniquement une copie compacte des données SKU déjà présentes dans la page.
	// Les prix/SKU restent passifs. Le stock peut déclencher un résolveur borné côté MAIN
	// uniquement lorsque les SKU réels sont déjà connus et que leur disponibilité reste inconnue.
	function requestPageSkuData( timeoutMs, options ) {
		const timeout = timeoutMs == null ? 8000 : timeoutMs;
		return new Promise( ( resolve ) => {
			const requestId = `cdh-sku-${ Date.now() }-${ Math.random().toString( 36 ).slice( 2 ) }`;
			let done = false;
			const finish = ( payload ) => {
				if ( done ) return;
				done = true;
				window.removeEventListener( 'message', onMessage );
				clearTimeout( timer );
				resolve( payload && typeof payload === 'object' ? payload : { source: null, dimensions: [], combinations: [] } );
			};
			const onMessage = ( event ) => {
				if ( event.source !== window || ! event.data || event.data.source !== 'cdh-page-bridge' ) return;
				if ( event.data.type !== 'CDH_SKU_DATA' || event.data.requestId !== requestId ) return;
				finish( event.data.payload );
			};
			const timer = setTimeout( () => finish( { source: null, dimensions: [], combinations: [], timeout: true } ), timeout );
			window.addEventListener( 'message', onMessage );
			window.postMessage( {
				source: 'cdh-isolated',
				type: 'CDH_REQUEST_SKU_DATA',
				requestId,
				waitForDescriptionMs: options && Number( options.waitForDescriptionMs || 0 ) || 0,
				resolveMatrix: !! ( options && options.resolveMatrix ),
				maxMatrixResolveValues: options && Number( options.maxMatrixResolveValues || 24 ) || 24,
				matrixResolveBudgetMs: options && Number( options.matrixResolveBudgetMs || 6500 ) || 6500,
				matrixResolvePerValueMs: options && Number( options.matrixResolvePerValueMs || 700 ) || 700,
				resolveStock: !! ( options && options.resolveStock ),
				maxStockResolveSkus: options && Number( options.maxStockResolveSkus || 24 ) || 24,
				stockResolveBudgetMs: options && Number( options.stockResolveBudgetMs || 5200 ) || 5200,
				stockResolvePerSkuMs: options && Number( options.stockResolvePerSkuMs || 420 ) || 420,
			}, '*' );
		} );
	}

	function normalizeSkuCurrency( skuData, fallbackCurrency ) {
		const fallback = String( fallbackCurrency || '' ).toUpperCase();
		const combinations = Array.isArray( skuData && skuData.combinations ) ? skuData.combinations : [];
		return combinations.map( ( combo ) => {
			const copy = Object.assign( {}, combo );
			if ( copy.supplier_price && ! copy.supplier_price.currency ) copy.supplier_price.currency = fallback;
			if ( copy.supplier_regular_price && ! copy.supplier_regular_price.currency ) copy.supplier_regular_price.currency = fallback;
			return copy;
		} );
	}

	function variantsFromSkuDimensions( dimensions, visibleVariants ) {
		const visible = Array.isArray( visibleVariants ) ? visibleVariants : [];
		const out = [];
		for ( const dimension of Array.isArray( dimensions ) ? dimensions : [] ) {
			const dimensionName = String( dimension && dimension.name || '' ).trim();
			if ( ! dimensionName ) continue;
			for ( const option of Array.isArray( dimension.values ) ? dimension.values : [] ) {
				const label = String( option && option.label || '' ).trim();
				if ( ! label ) continue;
				const match = visible.find( ( item ) => String( item && item.label_raw || '' ).trim().toLowerCase() === label.toLowerCase() );
				out.push( {
					supplier_variation_key: `${ slugify( dimensionName ) }:${ slugify( label ) }`,
					dimension_label: dimensionName,
					label_raw: label,
					image_url: normalizeSupplierMediaUrl( option.image_url || ( match && match.image_url ) || '' ) || null,
					source_property_id: String( dimension.property_id || '' ),
					source_value_id: String( option.value_id || '' ),
				} );
			}
		}
		return out.length ? out : visible;
	}

	// ---------------------------------------------------------------------
	// 4. supplier_product_id / supplier_url
	// ---------------------------------------------------------------------
	function extractSupplierProductId() {
		const match = location.pathname.match( /(\d{6,})\.html/ );
		return match ? match[ 1 ] : null;
	}

	// ---------------------------------------------------------------------
	// Assemblage + validation — §6.2 dernier paragraphe
	// ---------------------------------------------------------------------
	// Asynchrone depuis le 2026-08-31 (cf. extractDescriptionHtml ci-dessus) : à utiliser en
	// console avec `await CDH.extractProduct()` (top-level await supporté nativement par les
	// DevTools Chrome) — sans le `await`, on obtient une Promise en attente, pas le résultat.
	async function extractProduct( requestOpts ) {
		const { product, video } = findJsonLdEntries();
		const descriptionWaitOpts = requestOpts && requestOpts.descriptionWaitOpts ? requestOpts.descriptionWaitOpts : requestOpts;
		const extraction = requestOpts && requestOpts.extraction && typeof requestOpts.extraction === 'object' ? requestOpts.extraction : {};
		const enabled = ( key, fallback = true ) => extraction[ key ] === undefined ? fallback : extraction[ key ] !== false;
		const maxWaitMs = descriptionWaitOpts && descriptionWaitOpts.maxWaitMs;
		const intervalMs = descriptionWaitOpts && descriptionWaitOpts.intervalMs;

		// Description en PREMIER : la version validée sur le terrain déclenchait le lazy rendering
		// avant les nouveaux traitements longs (caractéristiques + pont SKU). Cette priorité évite
		// qu'un délai du pont SKU ne fasse régresser l'extraction de description.
		let descriptionResult;
		if ( ! enabled( 'description', true ) ) {
			descriptionResult = { html: '', status: 'disabled', diagnostics: { source: 'profile_disabled' } }; preparedDescriptionResult = null;
		} else if ( preparedDescriptionResult && preparedDescriptionResult.status === 'extracted' && preparedDescriptionResult.html ) {
			descriptionResult = preparedDescriptionResult;
			preparedDescriptionResult = null;
		} else {
			preparedDescriptionResult = null;
			descriptionResult = await extractDescriptionResult( maxWaitMs, intervalMs );
		}
		const specifications = enabled( 'characteristics', true ) ? await extractSpecifications() : [];
		const documents = enabled( 'documents', true ) ? extractSupplierDocuments() : [];
		const sizeGuide = enabled( 'size_guide', true ) ? await extractSizeGuide() : null;
		const visibleVariants = enabled( 'variants', true ) ? extractVariants() : [];
		const skuData = enabled( 'variants', true ) ? await requestPageSkuData( 18000, {
			resolveMatrix: true,
			maxMatrixResolveValues: 24,
			matrixResolveBudgetMs: 6500,
			matrixResolvePerValueMs: 700,
			resolveStock: true,
			maxStockResolveSkus: 24,
			stockResolveBudgetMs: 5200,
			stockResolvePerSkuMs: 420,
		} ) : { source: null, dimensions: [], combinations: [], diagnostics: { profile_disabled: true } };
		const shippingCurrent = enabled( 'shipping', true ) ? extractCurrentShipping( skuData, ( extractBasePrice( product ) || {} ).currency || '' ) : null;

		// Si la première passe n'a rien trouvé, la page a eu plusieurs secondes supplémentaires
		// pour construire ses sections lazy pendant l'extraction SKU : une dernière lecture
		// synchrone récupère ce contenu sans rajouter une nouvelle attente de 8 secondes.
		if ( enabled( 'description', true ) && descriptionResult.status !== 'extracted' ) {
			const lateRead = tryReadDescriptionDetailed();
			if ( lateRead.html ) {
				descriptionResult = {
					html: lateRead.html, status: 'extracted',
					diagnostics: Object.assign( {}, descriptionResult.diagnostics || {}, {
						source: lateRead.source || 'late_retry', matchedSelector: lateRead.selector || null,
						shadowRootsFound: Number( lateRead.shadowRootsFound || 0 ), iframeFound: !! lateRead.iframeFound,
						iframeAccessible: lateRead.iframeAccessible, iframeError: lateRead.iframeError || null, lateRetry: true,
					} ),
				};
			}
		}

		// Fallback runtime MAIN-world : certaines builds AliExpress conservent le HTML de
		// description (ou au minimum son URL source) dans runParams/data sans le rendre lisible
		// dans le DOM isolé. Le bridge ne déclenche aucune requête réseau : il ne renvoie que ce
		// qui est déjà présent dans l'état JavaScript de la page.
		if ( enabled( 'description', true ) && descriptionResult.status !== 'extracted' && skuData && skuData.description ) {
			const runtimeDescription = skuData.description;
			if ( runtimeDescription.html && isTrustedDescriptionHtml( runtimeDescription.html, true ) ) {
				descriptionResult = {
					html: runtimeDescription.html,
					status: 'extracted',
					diagnostics: Object.assign( {}, descriptionResult.diagnostics || {}, {
						source: 'runtime',
						runtimeSource: runtimeDescription.source || null,
						runtimeDescriptionUrl: runtimeDescription.url && runtimeDescription.url.url ? runtimeDescription.url.url : null,
						runtimeFallback: true,
					} ),
				};
			} else if ( runtimeDescription.url ) {
				descriptionResult = {
					html: '',
					status: descriptionResult.status === 'not_found' ? 'runtime_url_only' : descriptionResult.status,
					diagnostics: Object.assign( {}, descriptionResult.diagnostics || {}, {
						runtimeDescriptionUrl: runtimeDescription.url.url || null,
						runtimeDescriptionUrlSource: runtimeDescription.url.source || null,
					} ),
				};
			}
		}

		// Dernier filet de sécurité réseau : après le scroll lazy, certaines builds chargent la
		// description légèrement après la matrice SKU. Le bridge MAIN-world peut attendre brièvement
		// une réponse déjà initiée par AliExpress, sans déclencher de requête supplémentaire.
		if ( enabled( 'description', true ) && descriptionResult.status !== 'extracted' ) {
			try {
				const lateBridge = await requestPageSkuData( 2600, { waitForDescriptionMs: 1800 } );
				const lateDescription = lateBridge && lateBridge.description;
				if ( lateDescription && lateDescription.html && isTrustedDescriptionHtml( lateDescription.html, true ) ) {
					descriptionResult = {
						html: lateDescription.html, status: 'extracted',
						diagnostics: Object.assign( {}, descriptionResult.diagnostics || {}, {
							source: 'network_late', runtimeSource: lateDescription.source || null,
							lateNetworkRetry: true, networkDescriptionUrl: lateDescription.url && lateDescription.url.url ? lateDescription.url.url : null,
						} ),
					};
				} else if ( lateDescription && lateDescription.url && descriptionResult.status === 'not_found' ) {
					descriptionResult.status = 'runtime_url_only';
					descriptionResult.diagnostics = Object.assign( {}, descriptionResult.diagnostics || {}, {
						runtimeDescriptionUrl: lateDescription.url.url || null, lateNetworkRetry: true,
					} );
				}
			} catch ( e ) {}
		}

		const result = {
			supplier_key: 'aliexpress',
			supplier_product_id: extractSupplierProductId(),
			supplier_url: location.href,
			title: product && product.name ? String( product.name ).trim() : '',
			description_html: descriptionResult.html,
			description_status: descriptionResult.status,
			description_diagnostics: descriptionResult.diagnostics,
			// Galerie DOM en priorité (complète), JSON-LD en repli seulement (cf. commentaires
			// ci-dessus — 2026-08-31).
			images: enabled( 'images', true ) ? ( () => {
				const dom = extractGalleryImagesFromDom();
				return dom.length ? dom : extractImagesFromJsonLd( product );
			} )() : [],
			video: enabled( 'video', true ) ? extractVideoFromJsonLd( video ) : null,
			brand: enabled( 'brand', true ) && product && product.brand
				? ( typeof product.brand === 'string' ? product.brand : product.brand.name || '' )
				: '',
			base_price: extractBasePrice( product ),
			availability: enabled( 'availability', true ) ? extractAvailability( product ) : '',
			rating: enabled( 'rating', true ) ? extractRating( product ) : { value: null, count: null },
			variants: enabled( 'variants', true ) ? variantsFromSkuDimensions( skuData.dimensions, visibleVariants ) : [],
			supplier_variant_dimensions: enabled( 'variants', true ) && Array.isArray( skuData.dimensions ) ? skuData.dimensions : [],
			supplier_variations: enabled( 'variants', true ) ? normalizeSkuCurrency( skuData, product && product.offers ? ( extractBasePrice( product ) || {} ).currency : '' ) : [],
			supplier_sku_source: skuData.source || null,
			supplier_sku_captured_at: skuData.captured_at || new Date().toISOString(),
			supplier_sku_diagnostics: skuData.diagnostics || {},
			attributes: specifications,
			documents,
			size_guide: sizeGuide,
			shipping_current: shippingCurrent,
			supplier: ( () => { const supplier = extractSupplier( product ); if ( ! enabled( 'supplier_store', true ) ) { supplier.store_name = ''; supplier.store_url = ''; } if ( ! enabled( 'sales', true ) ) supplier.sold_count_text = ''; return supplier; } )(),
		};

		// Validation avant d'activer le bouton d'import (§6.2) : title non vide, base_price.amount
		// > 0, au moins une image détectée — sinon le popup doit désactiver le bouton avec un
		// message explicite plutôt que d'envoyer des données vides (branché à l'étape 4, pas ici).
		const errors = [];
		if ( ! result.title ) errors.push( 'title introuvable (bloc JSON-LD Product absent ou sans "name")' );
		if ( ! result.base_price || ! ( result.base_price.amount > 0 ) ) errors.push( 'base_price introuvable ou <= 0' );
		if ( enabled( 'images', true ) && ! result.images.length ) errors.push( 'aucune image détectée' );

		return { ok: errors.length === 0, errors, data: result };
	}

	root.CDH = {
		extractProduct, debugDescription, debugIframe, extractSpecificationsOnce,
		requestPageSkuData, extractDescriptionHtml, extractDescriptionResult, prepareDescriptionForEditor,
		__test: { normalizeSupplierMediaUrl, hasMeaningfulContent, isTrustedDescriptionHtml, descriptionQuality, descriptionRejectReason, cleanDescriptionElementHtml, findPreferredDescriptionInNav, tryReadDescriptionDetailed, getAllRoots, waitForDescriptionAnchor, extractSupplierDocuments, parseSizeMeasurement, readSizeMeasurements, findSizeGuideProperty, parseSupplierMoneyText, parseDeliveryWindow, extractCurrentShipping, supplierSkuForSelectedAttributes }
	};

	// Pratique pour le test manuel en console DevTools (§11 étape 3) : coller ce fichier, puis
	// `await CDH.extractProduct()` (avec le `await` — la fonction est asynchrone depuis le
	// 2026-08-31, le temps d'attendre que la description se charge, jusqu'à 8s par défaut) affiche
	// le résultat sans rien envoyer nulle part.

	// ---------------------------------------------------------------------
	// Pont vers popup.js — étape 4 (§11)
	// ---------------------------------------------------------------------
	// N'exécute rien tout seul au chargement de la page (toujours vrai) : ce content script se
	// contente d'enregistrer un écouteur de message, l'extraction elle-même ne se déclenche que
	// sur demande explicite du popup (`chrome.tabs.sendMessage`), jamais automatiquement à chaque
	// ouverture de fiche. Garde `typeof chrome !== 'undefined'` : permet à ce même fichier de
	// continuer à fonctionner tel quel collé en console DevTools (`chrome.runtime` y est parfois
	// absent/restreint) ET dans les tests jsdom (`chrome` n'existe pas du tout dans ce contexte).
	if ( typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage ) {
		chrome.runtime.onMessage.addListener( ( message, sender, sendResponse ) => {
			if ( ! message ) return;
			if ( message.type === 'CDH_PREPARE_DESCRIPTION' ) {
				prepareDescriptionForEditor( message.maxWaitMs, message.intervalMs )
					.then( ( result ) => sendResponse( {
						ok: true, status: result && result.status ? result.status : 'not_found',
						diagnostics: result && result.diagnostics ? result.diagnostics : {},
					} ) )
					.catch( ( err ) => sendResponse( { ok: false, error: err && err.message ? err.message : String( err ) } ) );
				return true;
			}
			if ( message.type !== 'CDH_EXTRACT_PRODUCT' ) return;
			extractProduct( { descriptionWaitOpts: message.descriptionWaitOpts || {}, extraction: message.extraction || {} } )
				.then( ( result ) => sendResponse( { ok: true, result } ) )
				.catch( ( err ) => sendResponse( { ok: false, error: err && err.message ? err.message : String( err ) } ) );
			return true;
		} );
	}
} )( typeof window !== 'undefined' ? window : globalThis );
