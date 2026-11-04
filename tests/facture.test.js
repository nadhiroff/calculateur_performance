/* Factures B2C / B2B au modèle Facture_exemple.pdf — lancer : node tests/facture.test.js
   Chiffres de référence : onglets RECAP (B2B) et FACTURE A FAIRE (B2C) des fichiers de M. William. */
'use strict';
const assert = require('assert');
const path = require('path');
const F = require('../calculateur/assets/js/facturation_calc.js');
const fx = (n) => require(path.join(__dirname, 'fixtures', n));

let ok = 0, ko = 0;
const t = (nom, fn) => { try { fn(); ok++; console.log('  ✔ ' + nom); } catch (e) { ko++; console.log('  ✘ ' + nom + '\n    ' + e.message); } };
const ligne = (f, nom) => f.lignes.find((l) => l.nom === nom);

console.log('\nFacture B2B (RGZ fichier B2B.xlsx, onglet RECAP)');
const b2b = F.calculB2B(F.lireB2B(fx('b2b_real.json')).lignes), fb = F.facture(b2b);
t('84 ventes payées dont 1 report payé', () => { assert.strictEqual(b2b.payees, 84); assert.strictEqual(b2b.reportsPayes, 1); });
t('commission vendeur 882 400 + commission partenaire 220 600 = lignes one-shot (HT)', () => {
  const os = fb.lignes.filter((l) => !/^PRIME|^Prime/.test(l.nom)).reduce((s, l) => s + l.montantHT, 0);
  assert.strictEqual(b2b.commVTB, 882400); assert.strictEqual(b2b.commPVT, 220600); assert.strictEqual(os, 882400 + 220600);
});
t('prime vendeur 325 000 = somme des lignes « Prime de Performance »', () => {
  assert.strictEqual(fb.lignes.filter((l) => l.nom.startsWith('Prime de Performance')).reduce((s, l) => s + l.montantHT, 0), 325000);
});
t('prime partenaire 105 000 = 1 250 × 84 (TTC 1 475 × 84)', () => {
  const l = ligne(fb, 'PRIME DU PARTENAIRE');
  assert.strictEqual(l.montantHT, 105000); assert.strictEqual(l.prixTTC, 1475); assert.strictEqual(l.quantite, 84);
});
t('total HT 1 533 000 · TVA 275 940 · TTC 1 808 940', () => {
  assert.deepStrictEqual([fb.ventilation.imposable, fb.ventilation.impot, fb.total], [1533000, 275940, 1808940]);
  assert.strictEqual(fb.total, b2b.totalTTC);
});
t('prime vendeur comptée hors reports : pms_rgz_wmarius (1 vente = 1 report) sans ligne de prime', () => {
  assert.ok(!fb.lignes.some((l) => /wmarius/.test(l.nom)));
});

console.log('\nFacture B2C (POINT VENTES FTTH RGZ SEPTEMBRE 2026 B2C.xlsx, onglet FACTURE A FAIRE)');
const b2c = F.calculB2C(F.lireB2C(fx('b2c_copie.json')).lignes), fc = F.facture(b2c);
t('1 009 ventes facturables : 996 × 50M + 13 × 100M (FTTH_PRO_50M exclue)', () => {
  assert.strictEqual(b2c.quantite, 1009);
  assert.strictEqual(ligne(fc, 'FTTH_Home_50M').quantite, 996); assert.strictEqual(ligne(fc, 'FTTH_Home_100M').quantite, 13);
  assert.ok(!fc.lignes.some((l) => /PRO/.test(l.nom)));
});
t('one-shot 10 155 000 HT (prix TTC 11 800 et 17 700, comme le PDF)', () => {
  assert.strictEqual(ligne(fc, 'FTTH_Home_50M').montantHT + ligne(fc, 'FTTH_Home_100M').montantHT, 10155000);
  assert.strictEqual(ligne(fc, 'FTTH_Home_50M').prixTTC, 11800); assert.strictEqual(ligne(fc, 'FTTH_Home_100M').prixTTC, 17700);
});
t('prime partenaire 1 513 500 = 1 500 × 1 009', () => { const l = ligne(fc, 'PRIME DU PARTENAIRE'); assert.strictEqual(l.montantHT, 1513500); assert.strictEqual(l.quantite, 1009); });
t('libellé « Prime de Performance <login> (<ventes>) », quantité 1, comme le PDF', () => {
  const l = ligne(fc, 'Prime de Performance pms_rgz_hfrancine.ftth (40)');
  assert.ok(l, 'ligne absente'); assert.strictEqual(l.quantite, 1); assert.strictEqual(l.prixTTC, 147500);
});
t('ventilation : imposable = total HT du moteur, total = TTC du moteur', () => {
  assert.strictEqual(fc.ventilation.imposable, b2c.totalHT); assert.strictEqual(fc.total, b2c.totalTTC);
  assert.strictEqual(fc.ventilation.groupe, 'B - TAXABLE (18)%');
});
t('numérotation # continue à partir de 1', () => assert.deepStrictEqual(fc.lignes.map((l) => l.n), fc.lignes.map((_, i) => i + 1)));

console.log('\nCas du PDF (juillet 2026) : ventes d\'avant le 17/06 payées après → une ligne par prix');
t('FTTH_Home_20M d\'avant le 17/06 à 10 000 HT (11 800 TTC), 50M nouvelle grille 10 000 HT, 100M 15 000 HT', () => {
  const L = [];
  const v = (debit, jour, n) => { for (let i = 0; i < n; i++) L.push({ login: 'pvt_rgz_x.ftth', loginKey: 'pvt_rgz_x', debit, jour, paiement: 'PAYE' }); };
  v('FTTH_Home_20M', '2026-06-10', 4); v('FTTH_Home_50M', '2026-07-05', 3); v('FTTH_Home_50M', '2026-06-02', 2); v('FTTH_Home_100M', '2026-07-08', 1);
  const f = F.facture(F.calculB2C(L));
  const l50 = f.lignes.filter((l) => l.nom === 'FTTH_Home_50M');
  assert.strictEqual(ligne(f, 'FTTH_Home_20M').prixTTC, 11800);
  assert.deepStrictEqual(l50.map((l) => [l.prixHT, l.quantite]), [[15000, 2], [10000, 3]]);   // ancienne puis nouvelle grille
  assert.strictEqual(ligne(f, 'FTTH_Home_100M').prixTTC, 17700);
});

console.log('\n' + ok + ' réussis, ' + ko + ' échec(s)');
process.exit(ko ? 1 : 0);
