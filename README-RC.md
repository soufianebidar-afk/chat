# Constello Dropship Hub Extension — 1.14.3 RC1

## 1.14.3 RC1 — Reprise d’import sans doublon

- Accepte les deux résultats positifs du plugin WordPress : HTTP 201 lorsqu’un produit est créé et HTTP 200 lorsqu’un produit existant est réutilisé.
- Conserve dans la réponse client `created`, `idempotent_replay`, `import_action` et `product_id`.
- Ouvre la fiche WooCommerce existante lors d’une reprise et affiche clairement qu’aucun doublon n’a été créé.
- Requiert le plugin WordPress `1.0.0-rc19-idempotent-import` pour le contrat idempotent complet.

## 1.14.2 RC1 — Normalisation et fraîcheur fournisseur

- Normalise automatiquement les tailles alphabétiques avec apostrophe parasite (`L' → L`) côté WooCommerce, tout en conservant la valeur AliExpress brute.
- Signale les guides incomplets avec un état actionnable, par exemple `1 taille à compléter`, sans bloquer l'import ni inventer de mesures.
- Affiche la date et l'heure de vérification du délai de livraison fournisseur.
- Résume les coûts fournisseur par leur plage réelle, par exemple `CHF 27.00 → CHF 31.79 · 22 SKU`.
- Déplace un timestamp stock commun dans l'en-tête du détail SKU ; les observations restent par ligne lorsqu'elles diffèrent.
- Reste compatible avec le contrat de guide des tailles et de livraison du plugin WordPress `1.0.0-rc18-size-guide-ranges`.


## 1.14.1 RC1 — Guide des tailles : plages et unités par mesure

- Mesures simples et plages (`94`, `160–166`) prises en charge.
- Unité stockée par mesure (`cm`, `kg`, etc.) au lieu d'une unité globale obligatoire.
- Les unités explicites dans le libellé, par exemple `Poids (kg)`, priment sur un suffixe incohérent fourni par AliExpress (`50-65cm`) tout en conservant la valeur brute et un diagnostic.
- Saisie manuelle compatible avec les plages ; restauration de la valeur/plage fournisseur.
- `Taille` (dimension de variation) et `Tour de taille` (mensuration) sont distingués dans le tableau.
- Les badges Fournisseur ne sont plus répétés dans chaque cellule ; seuls `Manuel` et les alertes d'unité restent visibles.

Lot Livraison fournisseur + Guide des tailles éditable.

## Nouveautés

- Extrait le frais de livraison courant AliExpress séparément du prix fournisseur (`0` gratuit confirmé, `null` inconnu).
- Conserve les dates calendaires affichées comme preuve de snapshot, mais normalise le suivi en `delivery_min_days` / `delivery_max_days`.
- Rattache la livraison au SKU actuellement sélectionné lorsqu’un `supplier_sku_id` unique peut être résolu.
- Affiche Livraison fournisseur et Coût total fournisseur de référence dans Tarification et dans le pré-contrôle.
- Le coût total est informatif : la règle commerciale WordPress existante continue d’utiliser le prix fournisseur tant que l’utilisateur n’active pas explicitement une future base incluant la livraison.
- Guide des tailles : header corrigé sur l’attribut WooCommerce, résumé `x/y tailles documentées`, valeur source conservée et valeur WooCommerce affichée.
- Les cases de mesures manquantes peuvent être complétées manuellement ; une mesure fournisseur existante peut être modifiée puis restaurée.
- Chaque mesure conserve sa provenance `aliexpress` ou `manual`, ainsi que la valeur fournisseur d’origine si elle a été surchargée.

## Compatibilité

Requiert Constello Dropship Hub WordPress **1.0.0-rc19-idempotent-import** pour le contrat idempotent complet. Le moteur SKU/prix/stock validé reste fail-closed.
