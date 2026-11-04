/* Tests du moteur d'analyse (Évolution, Comparaisons, Alertes, Prévisions) — lancer : node tests/analyse.test.js
   Jeu de données construit à la main : chaque résultat attendu est recalculé dans le commentaire. */
'use strict';
const assert = require('assert');
const A = require('../calculateur/assets/js/analyse_calc.js');
let ok = 0, ko = 0;
const t = (nom, fn) => { try { fn(); ok++; console.log('  ✔ ' + nom); } catch (e) { ko++; console.log('  ✘ ' + nom + '\n    ' + e.message); } };
const proche = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, 'attendu ' + b + ', obtenu ' + a);

// Ventes : RGZ et un autre partenaire (AUTRES). v(jour, partenaire, segment, n, statut, login)
const L = [];
const v = (jour, partenaire, segment, n, statut = 'OK', login = 'pvt_rgz_a') => { for (let i = 0; i < n; i++) L.push({ jour, partenaire, segment, statut, loginKey: login, login }); };
// Septembre 2026
v('2026-09-01', 'RGZ', 'B2C', 4); v('2026-09-01', 'RGZ', 'B2B', 1); v('2026-09-01', 'AUTRES', 'B2C', 5);
v('2026-09-02', 'RGZ', 'B2C', 6, 'OK', 'pvt_rgz_b');
v('2026-09-15', 'RGZ', 'B2C', 10);
// Octobre 2026 (jeudi 1er)
v('2026-10-01', 'RGZ', 'B2C', 3); v('2026-10-01', 'RGZ', 'B2B', 1); v('2026-10-01', 'AUTRES', 'B2C', 4);
v('2026-10-02', 'RGZ', 'B2C', 2); v('2026-10-02', 'RGZ', 'B2C', 3, 'VALIDE');
v('2026-10-05', 'RGZ', 'B2C', 5, 'OK', 'pvt_rgz_c'); v('2026-10-05', 'AUTRES', 'B2B', 5);
const P = { partenaire: 'RGZ', statuts: ['OK'] };

console.log('\nDates');
t('semaine ISO du 01/10/2026 = S40 ; du 01/01/2027 = S53 de 2026', () => { assert.deepStrictEqual(A.semaineIso('2026-10-01'), { annee: 2026, num: 40 }); assert.deepStrictEqual(A.semaineIso('2027-01-01'), { annee: 2026, num: 53 }); });
t('lundi du jeudi 01/10/2026 = 28/09/2026 ; mois précédent de 2026-01 = 2025-12', () => { assert.strictEqual(A.lundiDe('2026-10-01'), '2026-09-28'); assert.strictEqual(A.moisDecale('2026-01', -1), '2025-12'); });

console.log('\nSéries');
t('jour 01/10 : RGZ 3 B2C + 1 B2B = 4, réseau 8, ratio B2B 25 %, PDM 50 %', () => {
  const s = A.serie(L, Object.assign({ du: '2026-10-01', au: '2026-10-01', gran: 'jour' }, P))[0];
  assert.deepStrictEqual([s.b2c, s.b2b, s.total, s.reseau], [3, 1, 4, 8]); proche(s.ratioB2B, 0.25); proche(s.pdm, 0.5);
});
t('le statut VALIDE n\'est pas compté (02/10 : 2 ventes, pas 5)', () => assert.strictEqual(A.serie(L, Object.assign({ du: '2026-10-02', au: '2026-10-02' }, P))[0].total, 2));
t('semaines d\'octobre au 05/10 : S40 (01→04) = 6, S41 (05→05) = 5', () => {
  const s = A.serie(L, Object.assign({ du: '2026-10-01', au: '2026-10-05', gran: 'semaine' }, P));
  assert.deepStrictEqual(s.map((x) => [x.cle, x.du, x.au, x.total]), [['2026-S40', '2026-10-01', '2026-10-04', 6], ['2026-S41', '2026-10-05', '2026-10-05', 5]]);
});
t('mois : septembre 21 RGZ / 26 réseau, octobre 11 RGZ / 20 réseau', () => {
  const s = A.serie(L, Object.assign({ du: '2026-09-01', au: '2026-10-05', gran: 'mois' }, P));
  assert.deepStrictEqual(s.map((x) => [x.cle, x.total, x.reseau]), [['2026-09', 21, 26], ['2026-10', 11, 20]]);
});

t('regrouper : 3 jours (jeu. 01/10, ven. 02/10, lun. 05/10) → 2 semaines ISO, 1 mois ; champs additionnés', () => {
  const j = [{ jour: '2026-10-05', n: 5, ok: 4 }, { jour: '2026-10-01', n: 3, ok: 3 }, { jour: '2026-10-02', n: 2, ok: 1 }];
  assert.deepStrictEqual(A.regrouper(j, 'semaine').map((x) => [x.cle, x.lib, x.n, x.ok]), [['2026-S40', 'S40 (01/10)', 5, 4], ['2026-S41', 'S41 (05/10)', 5, 4]]);
  assert.deepStrictEqual(A.regrouper(j, 'mois').map((x) => [x.lib, x.n, x.ok]), [['Octobre 2026', 10, 8]]);
  assert.deepStrictEqual(A.regrouper(j, 'jour').map((x) => x.lib), ['01/10', '02/10', '05/10']);
});

console.log('\nComparaisons');
t('Day on Day au 05/10 sur 5 jours : 01/10 = 4 (veille 0), 02/10 = 2 (−50 %), 05/10 = 5 (veille 0)', () => {
  const d = A.dayOnDay(L, Object.assign({ au: '2026-10-05', n: 5, objectifJour: 4 }, P)).jours;
  assert.deepStrictEqual(d.map((x) => [x.jour, x.total]), [['2026-10-01', 4], ['2026-10-02', 2], ['2026-10-03', 0], ['2026-10-04', 0], ['2026-10-05', 5]]);
  proche(d[1].evol, -0.5); assert.strictEqual(d[0].evol, null); proche(d[4].tauxObjectif, 1.25);
});
t('Week on Week octobre : S1 = 6, S2 = 5 (−1, −16,7 %), TRO 11 / 22 = 50 %', () => {
  const w = A.weekOnWeek(L, Object.assign({ cle: '2026-10', au: '2026-10-05', objectifMois: 22 }, P));
  assert.deepStrictEqual(w.semaines.map((x) => [x.rang, x.total, x.ecart]), [['S1', 6, null], ['S2', 5, -1]]); proche(w.semaines[1].evol, -1 / 6); proche(w.tro, 0.5);
});
t('Month on Month à date égale (1er → 5) : octobre 11 vs septembre 11 → 0 %, mois entiers : 11 vs 21', () => {
  const m = A.monthOnMonth(L, Object.assign({ mois: ['2026-09', '2026-10'], au: '2026-10-05', objectifs: { '2026-10': 22 } }, P));
  assert.deepStrictEqual(m.map((x) => [x.cle, x.total, x.aDate, x.complet]), [['2026-09', 21, 11, true], ['2026-10', 11, 11, false]]);
  proche(m[1].evolADate, 0); proche(m[1].evol, (11 - 21) / 21); proche(m[1].tro, 0.5);
});
t('Same Period S1 (jours 1 à 7) : septembre 11, octobre 11 (arrêté au 05/10), écart 0', () => {
  const s = A.samePeriod(L, Object.assign({ mois: ['2026-09', '2026-10'], au: '2026-10-05', rang: 1 }, P));
  assert.deepStrictEqual(s.map((x) => [x.cle, x.total, x.au]), [['2026-09', 11, '2026-09-07'], ['2026-10', 11, '2026-10-05']]); assert.strictEqual(s[1].ecart, 0);
});
t('Gap vs objectifs : jours ouvrés seulement ; semaine incomplète = objectif du jour × jours ouvrés', () => {
  const ouvre = (j) => { const d = A.versDate(j).getUTCDay(); return d > 0 && d < 6; };
  const g = A.gapObjectifs(L, Object.assign({ du: '2026-10-01', au: '2026-10-05', objectifJour: 4, objectifSemaine: 20, estOuvre: ouvre }, P));
  assert.deepStrictEqual(g.jours.map((x) => [x.jour, x.ventes, x.ecart]), [['2026-10-01', 4, 0], ['2026-10-02', 2, -2], ['2026-10-05', 5, 1]]);
  // S40 : jeudi + vendredi ouvrés sur 5 → 4 × 2 = 8 ; S41 : lundi seul → 4 × 1 = 4
  assert.deepStrictEqual(g.semaines.map((x) => [x.cle, x.ventes, x.objectif]), [['2026-S40', 6, 8], ['2026-S41', 5, 4]]);
});

console.log('\nAlertes');
t('au 05/10 : croissance 0 % à date égale, objectif 11 / 22, attente 3 VALIDE, top 3, ratio B2B 1/11 sous 20 %', () => {
  const a = A.alertes(L, Object.assign({ au: '2026-10-05', objectif: { b2c: 18, b2b: 4 }, ouvresRestants: 10 }, P));
  const titres = a.map((x) => x.titre).join(' | ');
  assert.ok(/Croissance vs septembre à date égale : \+0,0 %/.test(titres), titres);
  assert.ok(/Ratio B2B : 9,1 % \(objectif 18,2 %\)/.test(titres), titres);
  assert.ok(/Objectif du mois : 11 \/ 22 \(50,0 %\)/.test(titres), titres);
  assert.ok(/3 vente\(s\) RGZ en attente/.test(titres), titres);
  assert.ok(/Top 3 vendeurs du mois : pvt_rgz_a \(6\), pvt_rgz_c \(5\)/.test(titres), titres);
  // reste 18 − 10 = 8 B2C et 4 − 1 = 3 B2B → 11 ventes sur 10 jours = 1,1 / jour
  assert.ok(a.some((x) => /Reste 8 B2C et 3 B2B, soit 1,1 ventes par jour ouvré/.test(x.detail)));
});
t('vendeur en forte baisse : pvt_rgz_b 6 ventes en septembre (1→5), 0 en octobre', () => {
  const a = A.alertes(L, Object.assign({ au: '2026-10-05', objectif: { b2c: 18, b2b: 4 }, ouvresRestants: 10 }, P));
  assert.ok(a.some((x) => /forte baisse/.test(x.titre) && /pvt_rgz_b 0 contre 6/.test(x.detail)));
});

console.log('\nPrévisions (méthode DG)');
t('base = moyenne de (60/20/3) et (66/22/3) = 1 vente/agent/jour ; réaliste mois en cours = 40 + 3×1×1,1×10 = 73', () => {
  const r = A.previsions({ basesMois: [{ ventes: 60, b2b: 6, ouvres: 20, agents: 3 }, { ventes: 66, b2b: 6, ouvres: 22, agents: 3 }], commParVente: 10000, margeParVente: 2000 },
    [{ cle: '2026-10', ouvres: 22, ouvresEcoules: 12, realise: 40, realiseB2B: 4, croissance: 10, objB2C: 60, objB2B: 20, agents: 3 }, { cle: '2026-11', ouvres: 21, croissance: 10, objB2C: 60, objB2B: 20, agents: 3 }]);
  proche(r.basePerAgent, 1); proche(r.ratioB2B, 12 / 126);
  const oct = r.mois[0].scenarios;
  assert.strictEqual(oct.realiste.total, 73); assert.strictEqual(oct.pessimiste.total, Math.round(40 + 3 * 1.1 * 0.75 * 10)); assert.strictEqual(oct.optimiste.total, Math.round(40 + 3 * 1.1 * 1.25 * 10));
  // novembre : 3 × 1,1 × 21 = 69,3 → 69 ; atteinte 69 / 80
  assert.strictEqual(r.mois[1].scenarios.realiste.total, 69); proche(r.mois[1].scenarios.realiste.atteinte, 69 / 80);
  assert.strictEqual(r.totaux.realiste.total, 73 + 69); proche(r.totaux.realiste.marge, (73 + 69) * 2000);
});
t('croissance bornée entre −50 % et +100 %', () => {
  const r = A.previsions({ basesMois: [{ ventes: 20, b2b: 0, ouvres: 20, agents: 1 }], commParVente: 0, margeParVente: 0 }, [{ cle: '2026-11', ouvres: 10, croissance: 500, agents: 1 }]);
  assert.strictEqual(r.mois[0].scenarios.realiste.total, 20);   // 1 × 1 × (1 + 1) × 10
});

console.log('\n' + ok + ' réussis, ' + ko + ' échec(s)');
process.exit(ko ? 1 : 0);
