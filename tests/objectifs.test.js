/* Tests des objectifs du Tableau de bord (jour / semaine / période / mois) — lancer : node tests/objectifs.test.js
   Règle : objectifs de Paramètres › Objectifs (ligne TOTAL : jour, semaine, mois), sans recalcul ni arrondi ;
   objectif d'une période = objectif du jour × jours ouvrés de la période. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// objectifs.js est un module navigateur (window.CT) : chargé dans un bac à sable
const window = { CT: { cleLogin: (s) => String(s || '').trim().toLowerCase().replace(/-/g, '_').replace(/\.ftth$/, '') } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../calculateur/assets/js/objectifs.js'), 'utf8'), { window });
const O = window.CT.objectifs;
const OCT = require('./fixtures/objectifs_2026_10.json');   // objectifs d'octobre 2026 tels qu'en base (Paramètres)

let ok = 0, ko = 0;
const t = (nom, fn) => { try { fn(); ok++; console.log('  ✔ ' + nom); } catch (e) { ko++; console.log('  ✘ ' + nom + '\n    ' + e.message); } };

console.log('\nCas calculé à la main (février 2026, 5 jours ouvrés du 2 au 6)');
const MAIN = { periode: '2026-02', calendrier: { ouvres: [2, 3, 4, 5, 6] }, equipes: [
  { id: 'A', jour: 2, semaine: 9, logins: [{ login: 'pvt_rgz_a.ftth', b2c: 8, b2b: 2 }] },
  { id: 'B', jour: 1, semaine: 4, logins: [{ login: 'pvt_rgz_b.ftth', b2c: 5, b2b: 0 }] }] };
const T = O.totaux(MAIN);
t('Paramètres : jour 2 + 1 = 3, semaine 9 + 4 = 13, mois 10 + 5 = 15', () => assert.deepStrictEqual([T.jour, T.semaine, T.mois], [3, 13, 15]));
t('période 03 → 05 = 3 jours ouvrés × 3 = 9', () => assert.strictEqual(O.objectifPeriode(MAIN, '2026-02', '2026-02-03', '2026-02-05'), 9));
t('période sur un week-end (07 → 08) = 0', () => assert.strictEqual(O.objectifPeriode(MAIN, '2026-02', '2026-02-07', '2026-02-08'), 0));
t('jours ouvrés du lundi 02 au dimanche 08 = 5', () => assert.strictEqual(O.ouvresEntre(MAIN, '2026-02', '2026-02-02', '2026-02-08'), 5));

console.log('\nOctobre 2026 (objectifs en base = Paramètres › Objectifs, ligne TOTAL), au 18/10/2026');
const TO = O.totaux(OCT);
t('Jour = 79 (comme Paramètres)', () => assert.strictEqual(TO.jour, 79));
t('Semaine = 373 (comme Paramètres)', () => assert.strictEqual(TO.semaine, 373));
t('Mois = 1 487 (comme Paramètres : 1 247 B2C + 240 B2B)', () => { assert.strictEqual(TO.mois, 1487); assert.strictEqual(TO.b2c, 1247); assert.strictEqual(TO.b2b, 240); });
t('Période 01 → 18/10 = 79 × 12 jours ouvrés = 948 (entier, sans virgule)', () => {
  const v = O.objectifPeriode(OCT, '2026-10', '2026-10-01', '2026-10-18'); assert.strictEqual(v, 948); assert.ok(Number.isInteger(v));
});
t('semaine du 12 au 18/10 complète : 5 jours ouvrés sur 5 → objectif de la semaine (373)', () => {
  assert.strictEqual(O.ouvresEntre(OCT, '2026-10', '2026-10-12', '2026-10-18'), 5);
});
t('semaine commencée (12 → 14/10) : 79 × 3 = 237', () => assert.strictEqual(O.objectifPeriode(OCT, '2026-10', '2026-10-12', '2026-10-14'), 237));
t('18/10/2026 est un dimanche, non ouvré au calendrier', () => assert.strictEqual(O.estOuvre(OCT, '2026-10-18'), false));
t('période 12 → 16/10 = 79 × 5 = 395', () => assert.strictEqual(O.objectifPeriode(OCT, '2026-10', '2026-10-12', '2026-10-16'), 395));

console.log('\n' + ok + ' réussis, ' + ko + ' échec(s)');
process.exit(ko ? 1 : 0);
