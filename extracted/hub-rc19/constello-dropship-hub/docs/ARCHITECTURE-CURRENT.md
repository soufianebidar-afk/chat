# Constello Dropship Hub — architecture de référence

Version documentaire : STAB-01 — 2026-09-01

## Responsabilités

### Extension Chrome

L’extension est un collecteur fournisseur. Elle lit les données déjà présentes dans la fiche AliExpress et transmet :

- identité produit et fournisseur ;
- médias HTTPS ;
- description lorsqu’elle est réellement accessible ;
- dimensions/valeurs de variante ;
- matrice SKU réelle lorsqu’elle est détectée ;
- prix fournisseur brut de chaque SKU, devise, stock/disponibilité ;
- caractéristiques descriptives.

Elle n’applique aucune formule de prix de vente.

### Constello Dropship Hub WordPress

WordPress est l’autorité métier :

- devise WooCommerce ;
- règle de tarification commerciale ;
- calcul des prix de vente depuis le coût réel de chaque SKU ;
- création du produit et de ses variations ;
- statut `Import AliExpress` ;
- persistance fournisseur, historique et trace de calcul ;
- protection des prix manuels lors des recalculs.

## Invariants fail-closed

- aucune combinaison de variation n’est inventée par produit cartésien ;
- un produit variable sans matrice SKU réelle est refusé ;
- un SKU sans prix fournisseur réel est refusé ;
- une devise SKU différente de WooCommerce est refusée ;
- deux SKU devenus identiques après édition des attributs sont refusés ;
- une règle tarifaire WordPress active est nécessaire à l’import ;
- les overrides de prix manuels ne sont jamais écrasés automatiquement.

## Description

Ordre de lecture : DOM classique → Shadow DOM ouvert → iframe accessible → lazy rendering/polling → données runtime déjà présentes dans la page. Aucun fallback réseau AliExpress n’est déclenché par STAB-01.

États : `extracted`, `not_found`, `timeout`, `iframe_inaccessible`, `runtime_url_only`.

## Médias

Les ressources fournisseur sont HTTPS uniquement. `file:`, `blob:`, `chrome-extension:` et HTTP sont rejetés comme sources fournisseur. Les retouches locales `data:image/...` restent internes à l’éditeur jusqu’à leur upload WordPress.

## Tarification

Le coût de chaque SKU fournisseur est évalué par le pipeline WordPress versionné. Les étapes peuvent inclure coefficient, montant fixe, pourcentage, marge cible/minimale, bornes min/max et prix psychologique.

## Tests de stabilisation

- Extension : `node tests/run-all.js`
- WordPress : `php tests/run.php`

Ces tests sont des tests comportementaux synthétiques. Ils ne remplacent pas la recette sur une vraie fiche AliExpress ; aucun PASS terrain SKU/description n’est revendiqué tant que la fiche réelle n’a pas été retestée.


## RC13 — catalogue WooCommerce et profils d’extraction

- WordPress est l’autorité des correspondances catalogue : `CDH_Catalog_Settings`.
- `/cdh/v1/config` expose `extraction`, `attribute_catalog` et `attribute_mappings`.
- L’extension conserve le libellé/ID fournisseur pour le mapping SKU et transporte séparément la cible WooCommerce.
- Une dimension peut cibler un attribut propre au produit, un attribut global existant ou un nouvel attribut global.
- Les valeurs fournisseur et WooCommerce sont conservées séparément ; deux valeurs fournisseur mappées vers la même combinaison restent rejetées par le fail-closed SKU.
- Les profils d’extraction contrôlent les blocs optionnels ; titre, coût fournisseur et identifiants de traçabilité restent indispensables.

## RC15 — Stock fournisseur par SKU

Le contrat fournisseur par SKU contient désormais, en plus du prix :

- `stock_qty`: quantité exacte ou `null` si AliExpress ne l’expose pas ;
- `stock_status`: `in_stock`, `out_of_stock` ou `unknown` ;
- `available`: booléen nullable ;
- `observed_at`: horodatage de l’observation.

Règle fail-closed : `0` signifie une rupture réellement observée ; `null` signifie « quantité inconnue ». Le plugin ne transforme jamais `null` en `0`.

À l’import, WordPress conserve un snapshot `_cdh_supplier_sku_snapshot_v1` et une baseline `_cdh_supplier_sku_baseline_v1` contenant identité SKU, attributs, prix et stock. Ces snapshots préparent le futur monitoring prix + stock. RC15 ne synchronise pas automatiquement les quantités WooCommerce.


## RC16 — Documents fournisseur et guide des tailles

- `documents[]` transporte les PDF fournisseur séparément de la description.
- `POST /cdh/v1/import-document` télécharge uniquement un PDF HTTPS depuis un domaine média AliExpress autorisé, avec limite 20 Mo et signature `%PDF-`.
- Les documents importés sont rattachés au produit et stockés dans `_cdh_supplier_documents_v1`.
- `size_guide` reste une donnée structurée liée aux valeurs de taille, stockée dans `_cdh_size_guide_v1`.
- Le frontend WooCommerce expose des onglets Documents et Guide des tailles lorsqu'ils existent.

## RC17 — Livraison fournisseur et guide des tailles éditable

- `shipping_current` est une observation distincte du prix fournisseur. `fee = 0` signifie gratuité réellement observée ; `fee = null` signifie frais inconnus.
- Les dates calendaires AliExpress sont conservées comme preuve (`delivery_date_start/end`) mais le monitoring doit comparer `delivery_min_days` / `delivery_max_days`, afin d’éviter les faux changements dus au glissement quotidien de la date de commande.
- Le snapshot livraison conserve le contexte : SKU sélectionné lorsqu’il est résolu, attributs sélectionnés, quantité, devise, méthode si exposée et horodatage.
- `_cdh_supplier_shipping_current_v1`, `_cdh_supplier_shipping_snapshot_v1` et `_cdh_supplier_shipping_baseline_v1` préparent le futur monitoring `shipping_fee_changed`, `shipping_method_changed`, `delivery_delay_changed` et `landed_cost_changed`.
- `landed_cost` est calculé comme prix fournisseur de référence + frais de livraison uniquement lorsque la devise est compatible. Ce coût reste informatif en RC17 et ne modifie pas la règle commerciale existante.
- Le guide des tailles conserve désormais la cible WooCommerce (`target_attribute`, `target_value`) en plus des identités fournisseur.
- Chaque mesure conserve `source = aliexpress|manual`, la valeur fournisseur d’origine et l’horodatage de surcharge manuelle. Une saisie manuelle ne détruit donc jamais silencieusement la donnée fournisseur.


## RC18 — Guide des tailles : plages et unités par mesure

- Une mensuration peut être `single`, `range` ou `text`. Les plages conservent `min` / `max`; les unités sont stockées au niveau de chaque mesure.
- Les indications d’unité dans le libellé fournisseur (ex. `Poids (kg)`) sont prioritaires. Une incohérence avec la valeur brute est conservée via `unit_conflict`, `raw_value` et `raw_unit`.
- Une correction manuelle conserve `supplier_value` ou `supplier_min` / `supplier_max` et `supplier_unit` afin de permettre une restauration sans perte de provenance.

## RC19 — Import WooCommerce idempotent

- L’identité métier obligatoire d’un produit est `supplier_key + supplier_product_id`. Le titre n’intervient jamais dans la déduplication.
- Une nouvelle requête portant une identité déjà importée retourne le produit existant en HTTP 200 avec `idempotent_replay = true`; elle ne recrée pas le produit et ne reconsomme pas les médias temporaires.
- Un verrou WordPress atomique et temporaire protège la fenêtre entre la vérification et la création. Une deuxième vérification est effectuée après acquisition du verrou.
- L’identité est enregistrée immédiatement après `wp_insert_post`, avant les variations, métadonnées métier et médias. Si son enregistrement échoue, le brouillon incomplet est supprimé.
- Plusieurs produits partageant déjà la même identité provoquent l’erreur fail-closed `cdh_duplicate_supplier_identity` et doivent être corrigés manuellement.
- Le cycle `_cdh_import_state = processing|complete` empêche qu’une requête concurrente considère comme terminé un produit encore en construction. Un état `processing` devenu ancien est signalé comme import incomplet, sans création d’un doublon.
