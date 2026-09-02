# Console — 1.14.3 RC1

Sur une fiche AliExpress :

```js
const r = await CDH.extractProduct();
console.table(r.data.documents || []);
console.log(r.data.size_guide);
console.table(r.data.supplier_variations || []);
```

Vérifier : PDF HTTPS, `size_guide.sizes[]` structuré et matrice SKU/prix/stock inchangée.


## Livraison fournisseur et fraîcheur — 1.14.2

Dans la console de la fiche AliExpress :

```js
const r = await CDH.extractProduct();
r.data.shipping_current;
```

Vérifier `fee`, `currency`, `delivery_min_days`, `delivery_max_days`, `supplier_sku_id` (si résolu) et `observed_at`. `fee:null` signifie inconnu ; `fee:0` n’est accepté que si la gratuité est réellement détectée.
