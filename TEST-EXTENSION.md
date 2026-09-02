# Tests manuels — 1.14.3 RC1

1. Recharger l’extension puis une fiche AliExpress affichant un coût de livraison.
2. Vérifier le pré-contrôle : `Livraison fournisseur` doit afficher le montant réel ou `Gratuite`, jamais `0` lorsque la donnée est inconnue.
3. Vérifier Tarification : prix fournisseur et livraison restent séparés ; `Coût total fournisseur (réf.)` correspond à prix de référence + livraison.
4. Pour une fenêtre `sep. 10 - 18` observée le 1er septembre, vérifier l’affichage relatif `9–17 j`. Les dates calendaires ne servent pas directement de signal de changement.
5. Sur un guide des tailles partiel, ouvrir l’accordéon : le header de première colonne doit être `Taille` (ou le nom WooCommerce mappé), pas la concaténation XS/S/M/...
6. Vérifier le résumé `4/5 tailles documentées` lorsqu’une taille n’a aucune mesure.
7. Compléter manuellement Buste/Taille/Hanches/Longueur de la taille manquante, puis vérifier le badge `Manuel`.
8. Modifier une mesure fournisseur existante puis utiliser `↺` pour restaurer la valeur fournisseur.
9. Si `L' → L` est mappé, vérifier que le guide affiche `L` et conserve `Source : L'`.
10. Importer dans WordPress RC18 et vérifier l’onglet Fournisseur (livraison/coût total) et le Guide des tailles frontend.
11. Vérifier qu’une taille fournisseur `L'` est proposée comme `L` dans WooCommerce, avec `L'` conservé comme source.
12. Vérifier qu’un guide 3/4 affiche `1 taille à compléter` sans bloquer l’import.
13. Vérifier que la livraison affiche sa date/heure de vérification.
14. Vérifier que les coûts fournisseur affichent la plage min/max réelle.
15. Vérifier qu’un timestamp commun aux SKU apparaît dans l’en-tête, mais que des timestamps différents restent dans le tableau.
11. Refaire un produit multi-SKU : aucune régression SKU/prix/stock, aucune combinaison théorique.
