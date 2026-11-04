/* Lancer : node tests/facturation.test.js
   Compare le moteur (assets/js/facturation_calc.js) aux valeurs calculées par Excel dans les fichiers de M. William. */
'use strict';
const assert = require('assert');
const path = require('path');
const F = require('../calculateur/assets/js/facturation_calc.js');
const fx = (n) => require(path.join(__dirname, 'fixtures', n));

let ok = 0, ko = 0;
function test(nom, fn) { try { fn(); ok++; console.log('  ✔ ' + nom); } catch (e) { ko++; console.log('  ✘ ' + nom + '\n      ' + e.message.split('\n').join('\n      ')); } }

console.log('\nB2B — fichier « RGZ fichier B2B.xlsx » (onglets REAL / COMM / RECAP)');
{
  const att = fx('b2b_attendu.json');
  const { lignes } = F.lireB2B(fx('b2b_real.json'));
  const r = F.calculB2B(lignes);
  test('90 lignes lues, mois de vente détecté', () => { assert.strictEqual(lignes.length, 90); assert.strictEqual(r.moisVente, 'Vente Sept'); });
  test('RECAP : 84 ventes payées dont 1 report payé', () => { assert.strictEqual(r.payees, att.recap.pay); assert.strictEqual(r.reportsPayes, att.recap.reportPay); });
  test('RECAP : commission vendeur HT', () => assert.strictEqual(r.commVTB, att.recap.commVTB));
  test('RECAP : prime vendeur HT', () => assert.strictEqual(r.primeVTB, att.recap.primeVTB));
  test('RECAP : commission partenaire HT', () => assert.strictEqual(r.commPVT, att.recap.commPVT));
  test('RECAP : prime partenaire HT (84 ventes × 1 250)', () => assert.strictEqual(r.primePVT, att.recap.primePVT));
  test('RECAP : total HT et TTC (TVA 18 %)', () => { assert.strictEqual(r.totalHT, att.recap.totalHT); assert.strictEqual(r.totalTTC, att.recap.ttc); });
  test('COMM : chaque login (ventes, commission, report, prime, total, part partenaire)', () => {
    assert.strictEqual(r.logins.length, Object.keys(att.logins).length);
    r.logins.forEach((g) => {
      const e = att.logins[g.login]; assert.ok(e, 'login absent du fichier : ' + g.login);
      assert.deepStrictEqual({ v: g.ventes, c: g.commVTB, rp: g.reports, p: g.primeVTB, t: g.totalVTB, pvt: g.commPVT }, { v: e.vente, c: e.commVTB, rp: e.reports, p: e.primeVTB, t: e.totalVTB, pvt: e.commPVT }, g.login);
    });
  });
  test('login « pvt-rgz-olouis » (avec tirets) rapproché sans doublon', () => assert.strictEqual(r.logins.filter((g) => g.loginKey === 'pvt_rgz_olouis').length, 1));
}

console.log('\nB2C — fichier « POINT VENTES FTTH RGZ SEPTEMBRE 2026 B2C.xlsx »');
{
  const att = fx('b2c_attendu.json');
  const { lignes, ignorees } = F.lireB2C(fx('b2c_copie.json'));
  const r = F.calculB2C(lignes);
  test('1 085 ventes lues (onglet LISTE CLIENTS COPIE)', () => assert.strictEqual(lignes.length, 1085));
  test('FACTURE A FAIRE : 1 010 lignes « A PAYER » (13 en 100M, 996 en 50M, 1 PRO_50M)', () => {
    assert.strictEqual(lignes.filter((l) => l.paiement === 'PAYE').length, 1010);
    assert.strictEqual(lignes.filter((l) => l.paiement === 'PAYE' && l.debit === 'FTTH_HOME_100M').length, 13);
  });
  test('la ligne FTTH_PRO_50M (offre B2B) est exclue de la facture B2C et signalée', () => {
    assert.strictEqual(r.quantite, 1009); assert.ok(r.alertes.some((a) => /hors offre FTTH Home/.test(a.titre)));
  });
  test('quantités par débit : 996 × 50M et 13 × 100M', () => { assert.strictEqual(r.parDebit.FTTH_HOME_50M.quantite, 996); assert.strictEqual(r.parDebit.FTTH_HOME_100M.quantite, 13); });
  test('one-shot après le 17/06/2026 : 996 × 10 000 + 13 × 15 000 = 10 155 000', () => assert.strictEqual(r.oneShot, 10155000));
  test('répartition 80 % vendeurs / 20 % partenaire (hors Anonymat qui touche 100 %)', () => {
    assert.strictEqual(r.partVendeurs + r.partPartenaire, r.oneShot);
    const std = r.logins.filter((g) => !g.anonymat), os = std.reduce((s, g) => s + g.oneShot, 0);
    assert.ok(Math.abs(std.reduce((s, g) => s + g.partPartenaire, 0) - os * 0.2) < std.length, 'écart d\'arrondi trop grand');
    assert.strictEqual(r.logins.filter((g) => g.anonymat).reduce((s, g) => s + g.partPartenaire, 0), 0);
  });
  test('par login : quantités par débit identiques au tableau FACTURE A FAIRE', () => {
    let vus = 0;
    r.logins.forEach((g) => {
      const e = Object.entries(att).find(([k]) => F.cleLogin(k) === g.loginKey); assert.ok(e, 'login absent : ' + g.login);
      const a = e[1], tot = a['100M'] + a['50M'];                                     // le PRO_50M n'est pas du B2C
      assert.strictEqual(g.ventes, tot, g.login); assert.strictEqual(g.parDebit.FTTH_HOME_50M || 0, a['50M'], g.login); assert.strictEqual(g.parDebit.FTTH_HOME_100M || 0, a['100M'], g.login); vus++;
    });
    assert.ok(vus >= 30);
  });
  test('prime de performance vendeur : paliers 15/21/26/31/41', () => {
    const t = (n) => F.tranche(F.REGLES.b2c.primeVendeur, n);
    assert.deepStrictEqual([0, 14, 15, 20, 21, 25, 26, 30, 31, 40, 41, 80].map(t), [0, 0, 50000, 50000, 75000, 75000, 100000, 100000, 125000, 125000, 150000, 150000]);
  });
  test('prime partenaire : 1 009 ventes ≥ 600 → 1 500 × 1 009', () => { assert.strictEqual(r.prixPrimePartenaire, 1500); assert.strictEqual(r.primePartenaire, 1513500); });
  test('prime d\'objectif : non calculée sans objectif ; 500 000 si objectif ≤ 1 009 atteint ; 0 sinon', () => {
    assert.strictEqual(r.primeObjectif, 0);
    assert.strictEqual(F.calculB2C(lignes, { regles: { b2c: { objectif: 1000 } } }).primeObjectif, 500000);
    assert.strictEqual(F.calculB2C(lignes, { regles: { b2c: { objectif: 1200 } } }).primeObjectif, 0);
  });
  test('total HT = one-shot + primes vendeurs + prime partenaire (+ objectif)', () => assert.strictEqual(r.totalHT, r.oneShot + r.primeVendeurs + r.primePartenaire + r.primeObjectif));
  test('Anonymat : one-shot intégral (100 %) pour pvt_rgz_akoffi', () => { const g = r.logins.find((x) => x.loginKey === 'pvt_rgz_akoffi'); assert.ok(g.anonymat); assert.strictEqual(g.partVendeur, g.oneShot); assert.strictEqual(g.partPartenaire, 0); });
  test('commercial standard : 80 % du one-shot', () => { const g = r.logins.find((x) => x.loginKey === 'pvt_rgz_dthibaut'); assert.ok(!g.anonymat); assert.strictEqual(g.partVendeur, Math.round(g.oneShot * 0.8)); });
  test('ancienne grille avant le 17/06/2026 (50M = 15 000 ; 20M = 10 000)', () => {
    const l = (debit, jour) => ({ login: 'x', loginKey: 'x', equipe: '', debit, statut: 'OK', paiement: 'PAYE', jour });
    const c = F.calculB2C([l('FTTH_HOME_50M', '2026-06-16'), l('FTTH_HOME_20M', '2026-06-16'), l('FTTH_HOME_50M', '2026-06-17'), l('FTTH_HOME_20M', '2026-06-17')]);
    assert.strictEqual(c.oneShot, 15000 + 10000 + 10000 + 0);
  });
  test('un « REPORT PAYER » compte dans les quantités, un « PAIEMENT REPORTE » non', () => {
    const l = (p) => ({ login: 'a', loginKey: 'a', equipe: '', debit: 'FTTH_HOME_50M', statut: 'OK', paiement: F.etatPaiement(p), jour: '2026-09-02' });
    const c = F.calculB2C([l('A PAYER'), l('REPORT PAYER'), l('PAIEMENT REPORTE'), l('')]);
    assert.strictEqual(c.quantite, 2); assert.strictEqual(c.reportsPayes, 1); assert.strictEqual(c.nonPayes.reportes, 1); assert.strictEqual(c.nonPayes.nonValides, 1);
  });
  test('onglet LISTE CLIENTS : les 90 numéros B2B ajoutés en bas sont ignorés → mêmes résultats', () => {
    const lc = F.lireB2C(fx('b2c_liste_clients.json'));
    assert.strictEqual(lc.ignorees.sansDebit, 90);
    const r2 = F.calculB2C(lc.lignes); assert.strictEqual(r2.quantite, r.quantite); assert.strictEqual(r2.oneShot, r.oneShot);
  });
}

console.log('\nPoint financier par login (C)');
{
  const b2c = F.calculB2C(F.lireB2C(fx('b2c_copie.json')).lignes), b2b = F.calculB2B(F.lireB2B(fx('b2b_real.json')).lignes);
  const p = F.pointFinancier(b2c, b2b);
  test('80 % commercial + 20 % RGZ = one-shot, sauf Anonymat (100 / 0)', () => {
    p.lignes.forEach((g) => { assert.strictEqual(g.partCommercial + g.partRGZ, g.oneShot, g.login); if (g.anonymat) assert.strictEqual(g.partRGZ, 0, g.login); });
  });
  test('le total « one-shot » du point financier = B2C + B2B', () => assert.strictEqual(p.totaux.oneShot, b2c.oneShot + (b2b.commVTB + b2b.commPVT)));
  test('login présent en B2C et en B2B (pvt_rgz_gkohla) : ventes cumulées', () => {
    const g = p.lignes.find((x) => x.loginKey === 'pvt_rgz_gkohla'); assert.ok(g.ventesB2C > 0 && g.ventesB2B > 0); assert.strictEqual(g.ventes, g.ventesB2C + g.ventesB2B);
  });
  test('AIB 5 % sur la part commerciale de TOUS les logins (règle par défaut)', () => {
    const q = F.pointFinancier(b2c, b2b);
    assert.ok(q.lignes.length > 0 && q.lignes.every((g) => g.aib === Math.round(g.partCommercial * 0.05) && g.net === g.partCommercial - g.aib + g.primes));
    assert.strictEqual(q.totaux.aib, q.lignes.reduce((s, g) => s + g.aib, 0));
  });
  test('AIB en mode liste (aibTous = false) : logins concernés uniquement', () => {
    const q = F.pointFinancier(b2c, b2b, { regles: { aibTous: false, loginsAib: ['pms_rgz_tosee.ftth'] } });
    const a = q.lignes.find((x) => x.loginKey === 'pms_rgz_tosee'), b = q.lignes.find((x) => x.loginKey === 'pvt_rgz_dthibaut');
    assert.strictEqual(a.aib, Math.round(a.partCommercial * 0.05)); assert.strictEqual(b.aib, 0); assert.strictEqual(a.net, a.partCommercial - a.aib + a.primes);
  });
}

console.log('\nReports (D)');
{
  const { lignes } = F.lireB2C(fx('b2c_copie.json'));
  const par = F.reports(lignes, 'semaine'), mois = F.reports(lignes, 'mois');
  test('75 reportés au total, semaine par semaine', () => assert.strictEqual(par.reduce((s, r) => s + r.reportes, 0), 75));
  test('cumul mensuel = 75 en septembre', () => { assert.strictEqual(mois.length, 1); assert.strictEqual(mois[0].cumulReste, 75); });
  test('semaine ISO : 2026-09-01 → 2026-S36', () => assert.strictEqual(F.semaineDe('2026-09-01'), '2026-S36'));
}

console.log('\n' + ok + ' réussis, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
