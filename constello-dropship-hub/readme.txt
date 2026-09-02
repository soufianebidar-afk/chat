=== Constello Dropship Hub ===
Contributors: constello
Requires at least: 6.0
Requires PHP: 7.4
Requires Plugins: woocommerce
Stable tag: 1.0.0-rc19-idempotent-import

Constello Dropship Hub prépare et importe des produits AliExpress dans WooCommerce.


== 1.0.0-rc19-idempotent-import ==

* Exige l’identité fournisseur (`supplier_key` + `supplier_product_id`) pour chaque création produit.
* Une relance du même import retourne le produit WooCommerce existant avec succès, sans revalider ni consommer les médias temporaires.
* Ajoute un verrou court et atomique par identité fournisseur pour empêcher les doublons lors de clics ou requêtes simultanés.
* Enregistre l’identité immédiatement après la création du brouillon, avant les traitements produit, variations et médias.
* Refuse en mode fail-closed une identité fournisseur déjà dupliquée ou un import resté incomplet, et renvoie le produit à corriger.


== 1.0.0-rc18-size-guide-ranges ==

* Guide des tailles : support des plages de mesures (ex. 160–166 cm) et des unités par mesure.
* Normalisation des unités explicites dans les libellés (`Poids (kg)`) avec conservation des valeurs fournisseur brutes et diagnostic des incohérences.
* Conservation des valeurs/plages fournisseur lorsqu’une mesure est corrigée manuellement.
* Frontend WooCommerce : rendu des plages et distinction `Taille` / `Tour de taille`.

== 1.0.0-rc18-size-guide-ranges =

* Mesures simples/plages et unités par mesure pour les guides des tailles.
* Traçabilité des conflits d’unité fournisseur et restauration des données source après édition manuelle.

= 1.0.0-rc17-shipping-size-guide-edit ==
* Conserve les frais de livraison fournisseur séparément du prix produit et calcule un coût total fournisseur de référence.
* Normalise les fenêtres de livraison dynamiques en délais relatifs (`delivery_min_days` / `delivery_max_days`) pour préparer le monitoring sans faux changements calendaires.
* Crée snapshots current/baseline de livraison avec contexte SKU, devise, quantité et horodatage.
* Ajoute Livraison fournisseur au profil d’extraction et à l’onglet WooCommerce Fournisseur.
* Permet de compléter/modifier manuellement les mensurations du guide des tailles sans perdre la valeur fournisseur originale.
* Affiche la valeur WooCommerce de taille tout en conservant la valeur AliExpress source.


=
= 1.0.0-rc17-shipping-size-guide-edit =
* Ajoute le snapshot livraison fournisseur, le délai relatif et le coût total de référence.
* Ajoute l’édition manuelle traçable du guide des tailles.

= 1.0.0-rc16-documents-size-guide ==
* Ajoute l’import sécurisé des documents PDF fournisseur AliExpress dans la médiathèque WordPress.
* Conserve URL source, média WordPress et type de document sur le produit.
* Ajoute le guide des tailles structuré et des onglets WooCommerce frontend Documents / Guide des tailles.
* Ajoute les options d’extraction Documents produit et Guide des tailles aux profils Constello.
* Conserve le moteur SKU/prix/stock RC15 sans synchronisation automatique du stock WooCommerce.


== 1.0.0-rc15-sku-stock ==
* Conserve le stock fournisseur par SKU séparément du prix fournisseur par SKU.
* Distingue quantité 0, quantité inconnue et simple disponibilité afin de ne jamais inventer un stock.
* Mémorise stock_qty, stock_status, available et observed_at sur chaque variation fournisseur/WooCommerce.
* Crée un snapshot baseline/current des SKU fournisseur pour préparer le futur suivi prix + stock.
* Affiche la couverture du stock SKU dans l’onglet WooCommerce « Fournisseur ».
* Ne synchronise pas encore automatiquement le stock WooCommerce : cette RC collecte et trace uniquement la donnée fournisseur.

== 1.0.0-rc14-catalog-video ==
* Ajoute l’import vidéo fournisseur vers la médiathèque WordPress via /cdh/v1/import-video.
* Rattache la vidéo au produit et conserve la source AliExpress.
* Peut ajouter la vidéo importée à la fin de la description produit.
* Compatible avec le nouveau sélecteur hiérarchique de catégories et les mappings catalogue de l’extension 1.11.0.

== 1.0.0-rc13-catalog-mapping ==
* Ajoute les profils d’extraction WordPress (Essentiel, Standard, Complet, Personnalisé).
* Expose les attributs globaux WooCommerce et leurs termes à l’extension.
* Mémorise les correspondances AliExpress → WooCommerce, y compris les valeurs.
* Permet de réutiliser un attribut global existant ou d’en créer un nouveau pendant l’import.
* Les variations utilisent les taxonomies globales/termes WooCommerce quand un mapping global est choisi.
* Les images de valeurs de variante retouchées peuvent devenir l’image des variations WooCommerce.
* Nouveau endpoint authentifié /cdh/v1/catalog/mappings pour enregistrer les correspondances sans attendre l’import.

== 1.0.0-rc12-stab ==
* STAB-01 : stabilisation sans nouvelle fonction métier.
* Suppression de l’ancienne méthode morte `sanitize_variation_pricing()` : le seul moteur actif reste `CDH_Pricing_Rules::build_import_pricing()`.
* Durcissement de l’injection JSON de la règle tarifaire dans l’admin (`</script>` neutralisé explicitement).
* Nouvelle suite de tests comportementaux du moteur de prix et du fail-closed SKU sous `tests/`.
* Documentation de l’architecture SKU/tarification actuelle dans `docs/ARCHITECTURE-CURRENT.md`.

== 1.0.0-rc11 ==
* Tarification commerciale centralisée exclusivement côté WordPress.
* L’extension transmet les coûts SKU AliExpress bruts ; elle ne calcule plus les prix de vente.
* Constructeur de règle ouvert : coefficients, montants fixes, pourcentages, marge cible/minimale, minimum/maximum et prix psychologique.
* Étapes activables/désactivables et réordonnables ; règle versionnée à chaque enregistrement.
* Les variations mémorisent règle, version et trace de calcul pour audit.
* Les modifications manuelles de prix sont marquées et ne sont jamais écrasées lors d’un recalcul automatique.

== 1.0.0-rc10 ==
* Fail-closed sur les produits variables : aucune variation WooCommerce n'est créée sans matrice SKU/prix AliExpress vérifiée.
* Le produit cartésien théorique n'est plus accepté comme source de variations.

== 1.0.0-rc9 ==
* Prix fournisseur réels par SKU/combinaison conservés séparément pour chaque variation WooCommerce.

== 1.0.0-rc7 ==
* Onglet produit WooCommerce « Fournisseur ».
* Séparation stricte entre attributs de variation et caractéristiques descriptives.

== Changelog ==

= 1.0.0-rc19-idempotent-import =
* Import WooCommerce idempotent, réponse de reprise explicite, état d’import et verrou anti-concurrence par identité fournisseur.

= 1.0.0-rc16-documents-size-guide =
* Ajoute l’import sécurisé des documents PDF fournisseur AliExpress dans la médiathèque WordPress.
* Conserve URL source, média WordPress et type de document sur le produit.
* Ajoute le guide des tailles structuré et un onglet WooCommerce frontend responsive.
* Ajoute les options d’extraction Documents et Guide des tailles aux profils Constello.
* Conserve le moteur SKU/prix/stock RC15 sans synchronisation automatique du stock WooCommerce.
