from pathlib import Path
import json

editor_path = Path('editor.js')
editor = editor_path.read_text(encoding='utf-8')
if 'async function preflightExistingImport' in editor:
    raise SystemExit('preflight helper already exists')

marker = "\n\tasync function doImport() {\n"
if marker not in editor:
    raise SystemExit('doImport marker not found')

helper = r'''

	async function preflightExistingImport( payload ) {
		const supplierKey = String( payload && payload.supplier_key || 'aliexpress' ).trim() || 'aliexpress';
		const supplierProductId = String( payload && payload.supplier_product_id || '' ).trim();
		if ( ! supplierProductId ) {
			return { ok: false, proceed: false, message: 'Identifiant produit fournisseur manquant : vérification anti-doublon impossible.' };
		}

		let response = null;
		try {
			response = await chrome.runtime.sendMessage( {
				type: 'CDH_LOOKUP_PRODUCT',
				payload: { supplier_key: supplierKey, supplier_product_id: supplierProductId },
			} );
		} catch ( err ) {
			return { ok: false, proceed: false, message: 'Vérification anti-doublon impossible : connexion au Hub indisponible.' };
		}

		if ( ! response || ! response.ok ) {
			return {
				ok: false,
				proceed: false,
				message: response && response.message ? response.message : 'Vérification anti-doublon impossible : réponse Hub invalide.',
			};
		}

		const lookup = response.lookup;
		if ( ! lookup || typeof lookup.found !== 'boolean' ) {
			return { ok: false, proceed: false, message: 'Vérification anti-doublon impossible : état fournisseur indéterminé.' };
		}
		if ( lookup.found === false ) {
			return { ok: true, proceed: true };
		}

		if ( lookup.duplicate === true ) {
			if ( lookup.products_url ) {
				try { await chrome.runtime.sendMessage( { type: 'CDH_OPEN_SITE_URL', url: String( lookup.products_url ) } ); } catch ( err ) {}
			}
			return {
				ok: true,
				proceed: false,
				duplicate: true,
				message: 'Plusieurs produits WooCommerce utilisent cette identité fournisseur. Aucun média envoyé · corrige les doublons avant de relancer.',
			};
		}

		const product = lookup.product && typeof lookup.product === 'object' ? lookup.product : null;
		const editUrl = product && product.edit_url ? String( product.edit_url ) : '';
		if ( editUrl ) {
			try { await chrome.runtime.sendMessage( { type: 'CDH_OPEN_SITE_URL', url: editUrl } ); } catch ( err ) {}
		}
		return {
			ok: true,
			proceed: false,
			existing: true,
			message: editUrl
				? 'Produit fournisseur déjà présent dans WooCommerce · aucun média envoyé. Fiche existante ouverte.'
				: 'Produit fournisseur déjà présent dans WooCommerce · aucun média envoyé.',
		};
	}
'''
editor = editor.replace(marker, helper + marker, 1)

old = "\t\tels.importBtn.disabled = true; setStatus( 'Préparation de l’import…' );\n\t\ttry {\n\t\t\tpayload = await uploadLocalImages( payload );"
new = "\t\tels.importBtn.disabled = true; setStatus( 'Vérification anti-doublon…' );\n\t\ttry {\n\t\t\tconst preflight = await preflightExistingImport( payload );\n\t\t\tif ( ! preflight.ok ) { setStatus( 'Import bloqué : ' + preflight.message, 'error' ); updateValidation(); return; }\n\t\t\tif ( ! preflight.proceed ) { setStatus( preflight.message, preflight.duplicate ? 'error' : 'ok' ); updateValidation(); return; }\n\t\t\tsetStatus( 'Aucun doublon détecté · préparation de l’import…' );\n\t\t\tpayload = await uploadLocalImages( payload );"
if old not in editor:
    raise SystemExit('doImport upload marker not found')
editor = editor.replace(old, new, 1)
editor_path.write_text(editor, encoding='utf-8')

manifest_path = Path('manifest.json')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
if manifest.get('version') != '1.14.3':
    raise SystemExit(f"unexpected extension version: {manifest.get('version')}")
manifest['version'] = '1.14.4'
manifest['description'] = 'Prépare les produits AliExpress, vérifie les doublons avant tout upload média et gère les reprises d’import WooCommerce.'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

version_test = Path('tests/workspace-documents-size.test.js')
text = version_test.read_text(encoding='utf-8')
if "extension version is 1.14.3" not in text or "manifest.version==='1.14.3'" not in text:
    raise SystemExit('1.14.3 version test marker not found')
text = text.replace("extension version is 1.14.3", "extension version is 1.14.4")
text = text.replace("manifest.version==='1.14.3'", "manifest.version==='1.14.4'")
version_test.write_text(text, encoding='utf-8')

preflight_test = Path('tests/import-preflight.test.js')
preflight_test.write_text(r'''const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const doImport = editor.indexOf('async function doImport()');
const helper = editor.indexOf('async function preflightExistingImport');
const lookupCall = editor.indexOf("type: 'CDH_LOOKUP_PRODUCT'", helper);
const preflightCall = editor.indexOf('await preflightExistingImport( payload )', doImport);
const firstMediaUpload = editor.indexOf('payload = await uploadLocalImages( payload )', doImport);

const checks = [
  ['extension version is 1.14.4', manifest.version === '1.14.4'],
  ['preflight helper exists before import handler', helper >= 0 && doImport > helper],
  ['preflight calls supplier lookup', lookupCall > helper],
  ['lookup executes before any media upload', preflightCall > doImport && firstMediaUpload > preflightCall],
  ['lookup failure is fail-closed', editor.includes('Vérification anti-doublon impossible') && editor.includes("if ( ! preflight.ok )")],
  ['only explicit found false proceeds', editor.includes("if ( lookup.found === false )") && editor.includes("return { ok: true, proceed: true }" )],
  ['existing supplier product blocks upload', editor.includes("existing: true") && editor.includes('aucun média envoyé')],
  ['duplicate supplier identity blocks upload', editor.includes("duplicate: true") && editor.includes('corrige les doublons avant de relancer')],
  ['existing WooCommerce product can be opened safely', editor.includes("type: 'CDH_OPEN_SITE_URL'") && background.includes("message.type === 'CDH_OPEN_SITE_URL'")),
  ['server replay remains final race-condition guard', editor.includes('response.idempotent_replay') && background.includes('idempotent_replay: body.idempotent_replay === true')),
];

for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) process.exit(1);
}
''', encoding='utf-8')

run_all = Path('tests/run-all.js')
text = run_all.read_text(encoding='utf-8')
if "'import-preflight.test.js'" not in text:
    text = text.replace("'background-import.test.js',", "'background-import.test.js', 'import-preflight.test.js',")
run_all.write_text(text, encoding='utf-8')
