/* ============================================================================
   facturation_calc.js — moteur de calcul de la facturation Celtiis (B2C / B2B),
   du point financier par login et du cumul des reports.
   Fonctions PURES (aucun accès au DOM) : utilisables dans le navigateur (window.CT.fact)
   et sous Node pour les tests (tests/facturation.test.js).
   Barèmes : fichier « COMMISSION PRIME ET PERFORMANCE.xlsx » + onglets PLAN COMM du fichier B2B.
   ========================================================================== */
(function (racine, fabrique) {
  'use strict';
  const api = fabrique();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { racine.CT = racine.CT || {}; racine.CT.fact = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Barèmes (modifiables : passer { regles: {...} } aux fonctions de calcul) ---------- */
  const REGLES = {
    tva: 0.18,
    partVendeur: 0.8,                       // 80 % du one-shot au commercial, 20 % à RGZ
    aib: 0.05,                              // AIB : 5 % sur la part du commercial (80 %, Anonymat 100 %)
    aibTous: true,                          // TOUS les logins sont soumis à l'AIB (décision de la direction)
    loginsAib: [],                          // utilisé seulement si aibTous = false : liste des logins soumis
    loginsAnonymat: [                       // payés au one-shot intégral (100 %) + prime de performance
      'pvt_rgz_gprince', 'pvt_rgz_akoffi', 'pvt_rgz_agado', 'pvt_rgz_lcedric', 'pvt_rgz_hfulberto', 'pvt_rgz_agabriel',
      'pvt_rgz_kfranklin', 'pms_rgz_ajoel', 'pms_rgz_hbidossessi', 'pms_rgz_gsonagnon', 'pms_rgz_kjudith', 'pms_rgz_aessenam'],
    b2c: {
      changement: '2026-06-17',             // nouvelle grille à partir de cette date (DATE_COMMANDE)
      avant: { FTTH_HOME_20M: 10000, FTTH_HOME_50M: 15000, FTTH_HOME_70M: 20000, FTTH_HOME_100M: 0 },
      apres: { FTTH_HOME_20M: 0, FTTH_HOME_50M: 10000, FTTH_HOME_70M: 0, FTTH_HOME_100M: 15000 },
      // Prime de performance vendeur : [min ventes, prime]
      primeVendeur: [[0, 0], [15, 50000], [21, 75000], [26, 100000], [31, 125000], [41, 150000]],
      // Prime de performance partenaire : prix unitaire × quantité totale (reports payés compris)
      primePartenaire: [[0, 0], [200, 1000], [300, 1250], [600, 1500]],
      seuilNouveauPartenaire: 100,          // un nouveau partenaire est déclenché dès 100 ventes au lieu de 200
      nouveauPartenaire: false,
      // Prime d'atteinte de l'objectif FTTH : [volume réalisé min, prime] — versée seulement si objectif atteint
      primeObjectif: [[300, 200000], [600, 300000], [1000, 500000]],
      objectif: null,                       // objectif du mois (ventes) ; null = prime d'objectif non calculée
    },
    b2b: {
      oneShot: { FTTH_PRO_50M: 12000, FIBRE_PRO_MAX_100M: 17000, FIBRE_PRO_MEGA_150M: 23000, FIBRE_OFFICE_MAX_200M: 30000, FIBRE_OFFICE_MEGA_250M: 35000 },
      primeVendeur: [[0, 0], [5, 25000], [11, 50000], [16, 75000], [21, 100000]],      // sur ventes payées HORS reports
      primePartenaire: [[0, 0], [80, 1250], [150, 1500], [300, 1750]],                   // prix unitaire × total payé (reports compris)
      moisVente: null,                      // libellé TYPE_VENTE du mois (ex. « Vente Sept ») ; null = le plus fréquent
    },
  };

  /* ---------- Utilitaires ---------- */
  const nettoyer = (s) => String(s == null ? '' : s).trim();
  const majuscule = (s) => nettoyer(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
  /** Même normalisation que src/Support/LoginKey.php : minuscules, « - » → « _ », suffixe « .ftth » ignoré. */
  const cleLogin = (s) => nettoyer(s).toLowerCase().replace(/-/g, '_').replace(/\.ftth$/, '');
  const tranche = (paliers, n) => { let v = paliers[0][1]; for (const [min, val] of paliers) if (n >= min) v = val; return v; };
  const fusion = (base, sur) => {
    if (!sur || typeof sur !== 'object' || Array.isArray(sur)) return sur === undefined ? base : sur;
    const o = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(sur).forEach((k) => { o[k] = fusion(base ? base[k] : undefined, sur[k]); });
    return o;
  };
  const regles = (opts) => fusion(REGLES, opts && opts.regles);
  const arrondi = (n) => Math.round(n);
  const jourDe = (v) => {
    if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(nettoyer(v));
    if (m) return m[0];
    const f = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(nettoyer(v));
    return f ? f[3] + '-' + f[2].padStart(2, '0') + '-' + f[1].padStart(2, '0') : null;
  };
  /** Colonne d'un enregistrement, insensible à la casse / aux espaces. */
  const champ = (r, ...noms) => {
    for (const n of noms) { for (const k of Object.keys(r)) if (majuscule(k).replace(/ /g, '_') === n) return r[k]; }
    return undefined;
  };

  /* ============================== B2C ============================== */
  /* État de paiement d'une ligne du fichier de facturation :
       PAYE = « A PAYER » · REPORT_PAYE = « REPORT PAYER » (vente d'un mois antérieur payée ce mois)
       REPORTE = « PAIEMENT REPORTE » / « Paiement reporté » · NON_VALIDE = vide (vente non validée) */
  function etatPaiement(v) {
    const s = majuscule(v);
    if (!s) return 'NON_VALIDE';
    if (/REPORT.*PAYE|REPORT PAYER/.test(s)) return 'REPORT_PAYE';
    if (/^A PAYER$/.test(s)) return 'PAYE';
    if (/REPORT/.test(s)) return 'REPORTE';
    return 'NON_VALIDE';
  }

  /** Lignes brutes (objets) → lignes B2C normalisées. Les lignes sans DEBIT ni STATUS (numéros B2B ajoutés en bas
      de l'onglet « LISTE CLIENTS ») sont ignorées. */
  function lireB2C(rows) {
    const lignes = [], ignorees = { sansDebit: 0 };
    rows.forEach((r) => {
      const debit = nettoyer(champ(r, 'DEBIT')), statut = nettoyer(champ(r, 'STATUS'));
      if (!debit && !statut) { ignorees.sansDebit++; return; }
      const login = nettoyer(champ(r, 'LOGIN_VENDEUR') || champ(r, 'LOGIN'));
      lignes.push({
        login, loginKey: cleLogin(login), equipe: nettoyer(champ(r, 'EQUIPE')) || '',
        debit: debit.toUpperCase().replace(/^FTTH_HOME_/, 'FTTH_HOME_'), statut,
        paiement: etatPaiement(champ(r, 'PAIEMENT')), jour: jourDe(champ(r, 'DATE_COMMANDE')),
        msisdn: nettoyer(champ(r, 'MSISDN', 'NUMERO')),
      });
    });
    return { lignes, ignorees };
  }

  const cleDebit = (d) => majuscule(d).replace(/ /g, '_');
  const estDebitB2C = (d) => /^FTTH_HOME_\d+M$/.test(cleDebit(d));
  function oneShotB2C(debit, jour, R) {
    const grille = jour && jour < R.b2c.changement ? R.b2c.avant : R.b2c.apres;
    return grille[cleDebit(debit)] || 0;
  }

  /** Facturation B2C : quantités par débit (ventes payées + reports payés), one-shot, primes. */
  function calculB2C(lignes, opts) {
    const R = regles(opts), anon = new Set(R.loginsAnonymat.map(cleLogin));
    const alertes = [];
    const payables = lignes.filter((l) => l.paiement === 'PAYE' || l.paiement === 'REPORT_PAYE');
    const b2c = payables.filter((l) => estDebitB2C(l.debit));
    const horsB2C = payables.filter((l) => !estDebitB2C(l.debit));
    if (horsB2C.length) alertes.push({ niveau: 'warn', titre: horsB2C.length + ' ligne(s) payée(s) hors offre FTTH Home', detail: 'Débit(s) : ' + [...new Set(horsB2C.map((l) => l.debit))].join(', ') + ' — exclues de la facture B2C (à traiter en B2B).' });
    const sansTarif = b2c.filter((l) => oneShotB2C(l.debit, l.jour, R) === 0);
    if (sansTarif.length) alertes.push({ niveau: 'warn', titre: sansTarif.length + ' vente(s) sans one-shot', detail: 'Débit sans tarif à la date de la vente (grille du ' + R.b2c.changement + ').' });

    const debits = [...new Set(b2c.map((l) => cleDebit(l.debit)))].sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));
    const parLogin = new Map();
    b2c.forEach((l) => {
      let g = parLogin.get(l.loginKey);
      if (!g) parLogin.set(l.loginKey, (g = { loginKey: l.loginKey, login: l.login, equipe: l.equipe, anonymat: anon.has(l.loginKey), ventes: 0, reports: 0, parDebit: {}, oneShot: 0 }));
      const d = cleDebit(l.debit), os = oneShotB2C(l.debit, l.jour, R);
      g.ventes++; if (l.paiement === 'REPORT_PAYE') g.reports++;
      g.parDebit[d] = (g.parDebit[d] || 0) + 1; g.oneShot += os;
      if (!g.equipe && l.equipe) g.equipe = l.equipe;
    });
    const logins = [...parLogin.values()].map((g) => {
      g.partVendeur = arrondi(g.oneShot * (g.anonymat ? 1 : R.partVendeur));
      g.partPartenaire = g.oneShot - g.partVendeur;
      g.primePerf = tranche(R.b2c.primeVendeur, g.ventes);
      g.total = g.partVendeur + g.primePerf;
      return g;
    }).sort((a, b) => b.ventes - a.ventes || a.loginKey.localeCompare(b.loginKey));

    const qte = b2c.length, parDebit = {};
    debits.forEach((d) => { const n = b2c.filter((l) => cleDebit(l.debit) === d).length; parDebit[d] = { quantite: n, oneShot: b2c.filter((l) => cleDebit(l.debit) === d).reduce((s, l) => s + oneShotB2C(l.debit, l.jour, R), 0) }; });
    const oneShot = logins.reduce((s, g) => s + g.oneShot, 0);
    const seuil200 = R.b2c.nouveauPartenaire ? R.b2c.seuilNouveauPartenaire : 200;
    const prixPart = qte < seuil200 ? 0 : tranche(R.b2c.primePartenaire.slice(1), qte) || R.b2c.primePartenaire[1][1];
    const primePartenaire = qte * prixPart;
    let primeObjectif = 0, objectifAtteint = null;
    if (R.b2c.objectif != null) {
      objectifAtteint = qte >= R.b2c.objectif;
      primeObjectif = objectifAtteint && qte >= R.b2c.primeObjectif[0][0] ? tranche([[0, 0]].concat(R.b2c.primeObjectif), qte) : 0;
    }
    const primeVendeurs = logins.reduce((s, g) => s + g.primePerf, 0);
    const totalHT = oneShot + primeVendeurs + primePartenaire + primeObjectif;
    return {
      segment: 'B2C', debits, parDebit, logins, alertes,
      quantite: qte, reportsPayes: b2c.filter((l) => l.paiement === 'REPORT_PAYE').length,
      nonPayes: { reportes: lignes.filter((l) => l.paiement === 'REPORTE').length, nonValides: lignes.filter((l) => l.paiement === 'NON_VALIDE').length },
      oneShot, partVendeurs: logins.reduce((s, g) => s + g.partVendeur, 0), partPartenaire: logins.reduce((s, g) => s + g.partPartenaire, 0),
      primeVendeurs, prixPrimePartenaire: prixPart, primePartenaire, objectif: R.b2c.objectif, objectifAtteint, primeObjectif,
      totalHT, tva: arrondi(totalHT * R.tva), totalTTC: arrondi(totalHT * (1 + R.tva)),
    };
  }

  /* ============================== B2B ============================== */
  function lireB2B(rows) {
    const lignes = [];
    rows.forEach((r) => {
      const debit = nettoyer(champ(r, 'DEBIT'));
      if (!debit) return;
      const login = nettoyer(champ(r, 'LOGIN_VENDEUR'));
      const obs = majuscule(champ(r, 'OBSERVATION'));
      lignes.push({
        login, loginKey: cleLogin(login), debit: majuscule(debit).replace(/ /g, '_'), partenaire: nettoyer(champ(r, 'PARTENAIRE')),
        typeVente: nettoyer(champ(r, 'TYPE_VENTE')), jour: jourDe(champ(r, 'DATE')), msisdn: nettoyer(champ(r, 'MSISDN')),
        paiement: obs === 'A PAYER' ? 'PAYE' : /REPORT/.test(obs) ? 'REPORTE' : 'NON_VALIDE',
      });
    });
    return { lignes };
  }

  /** Facturation B2B (même méthode que les onglets REAL / COMM / RECAP du fichier de facturation). */
  function calculB2B(lignes, opts) {
    const R = regles(opts), anon = new Set(R.loginsAnonymat.map(cleLogin)), alertes = [];
    const payees = lignes.filter((l) => l.paiement === 'PAYE');
    let mois = R.b2b.moisVente;
    if (!mois) { const f = new Map(); payees.forEach((l) => f.set(l.typeVente, (f.get(l.typeVente) || 0) + 1)); mois = [...f.entries()].sort((a, b) => b[1] - a[1])[0] ? [...f.entries()].sort((a, b) => b[1] - a[1])[0][0] : ''; }
    const inconnus = payees.filter((l) => R.b2b.oneShot[l.debit] == null);
    if (inconnus.length) alertes.push({ niveau: 'warn', titre: inconnus.length + ' vente(s) B2B sans tarif', detail: 'Débit(s) : ' + [...new Set(inconnus.map((l) => l.debit))].join(', ') });
    const debits = Object.keys(R.b2b.oneShot);
    const parLogin = new Map();
    payees.forEach((l) => {
      let g = parLogin.get(l.loginKey);
      if (!g) parLogin.set(l.loginKey, (g = { loginKey: l.loginKey, login: l.login, partenaire: l.partenaire, anonymat: anon.has(l.loginKey), ventes: 0, reports: 0, parDebit: {}, oneShot: 0 }));
      g.ventes++; if (l.typeVente !== mois) g.reports++;
      g.parDebit[l.debit] = (g.parDebit[l.debit] || 0) + 1; g.oneShot += R.b2b.oneShot[l.debit] || 0;
    });
    const logins = [...parLogin.values()].map((g) => {
      g.commVTB = arrondi(g.oneShot * (g.anonymat ? 1 : R.partVendeur));
      g.commPVT = g.oneShot - g.commVTB;
      g.primeVTB = tranche(R.b2b.primeVendeur, g.ventes - g.reports);   // les reports ne comptent pas dans la prime vendeur
      g.totalVTB = g.commVTB + g.primeVTB;
      return g;
    }).sort((a, b) => b.ventes - a.ventes || a.loginKey.localeCompare(b.loginKey));
    const totalPaye = payees.length, reportsPayes = payees.filter((l) => l.typeVente !== mois).length;
    const prixPart = tranche(R.b2b.primePartenaire, totalPaye);
    const primePVT = totalPaye * prixPart;
    const commVTB = logins.reduce((s, g) => s + g.commVTB, 0), primeVTB = logins.reduce((s, g) => s + g.primeVTB, 0), commPVT = logins.reduce((s, g) => s + g.commPVT, 0);
    const totalHT = commVTB + primeVTB + commPVT + primePVT;
    const totalParDebit = {}; debits.forEach((d) => { totalParDebit[d] = payees.filter((l) => l.debit === d).length; });
    return {
      segment: 'B2B', moisVente: mois, debits, logins, alertes, totalParDebit,
      payees: totalPaye, reportsPayes, nonPayes: { reportes: lignes.filter((l) => l.paiement === 'REPORTE').length },
      commVTB, primeVTB, commPVT, prixPrimePVT: prixPart, primePVT, totalHT, tva: arrondi(totalHT * R.tva), totalTTC: arrondi(totalHT * (1 + R.tva)),
    };
  }

  /* ====================== Point financier par login ====================== */
  /** Réunit B2C et B2B : un login = une ligne. Commercial 80 % (Anonymat 100 %), RGZ 20 %, AIB 5 % sur la part du commercial (tous les logins). */
  function pointFinancier(c2c, c2b, opts) {
    const R = regles(opts), aib = new Set(R.loginsAib.map(cleLogin)), anon = new Set(R.loginsAnonymat.map(cleLogin));
    const m = new Map();
    const get = (k, login, equipe) => { let g = m.get(k); if (!g) m.set(k, (g = { loginKey: k, login, equipe: equipe || '', anonymat: anon.has(k), ventesB2C: 0, ventesB2B: 0, oneShotB2C: 0, oneShotB2B: 0, primeB2C: 0, primeB2B: 0 })); if (!g.equipe && equipe) g.equipe = equipe; return g; };
    (c2c ? c2c.logins : []).forEach((l) => { const g = get(l.loginKey, l.login, l.equipe); g.ventesB2C += l.ventes; g.oneShotB2C += l.oneShot; g.primeB2C += l.primePerf; });
    (c2b ? c2b.logins : []).forEach((l) => { const g = get(l.loginKey, l.login, ''); g.ventesB2B += l.ventes; g.oneShotB2B += l.oneShot; g.primeB2B += l.primeVTB; });
    const lignes = [...m.values()].map((g) => {
      g.ventes = g.ventesB2C + g.ventesB2B;
      g.oneShot = g.oneShotB2C + g.oneShotB2B;
      g.partCommercial = arrondi(g.oneShot * (g.anonymat ? 1 : R.partVendeur));
      g.partRGZ = g.oneShot - g.partCommercial;
      g.aib = R.aibTous || aib.has(g.loginKey) ? arrondi(g.partCommercial * R.aib) : 0;
      g.primes = g.primeB2C + g.primeB2B;
      g.net = g.partCommercial - g.aib + g.primes;
      return g;
    }).sort((a, b) => b.net - a.net || a.loginKey.localeCompare(b.loginKey));
    const somme = (k) => lignes.reduce((s, g) => s + g[k], 0);
    return { lignes, totaux: { ventes: somme('ventes'), oneShot: somme('oneShot'), partCommercial: somme('partCommercial'), partRGZ: somme('partRGZ'), aib: somme('aib'), primes: somme('primes'), net: somme('net') } };
  }

  /* ============================ Reports ============================ */
  /** Numéro de semaine ISO (« 2026-S36 ») d'un jour AAAA-MM-JJ. */
  function semaineDe(jour) {
    const [y, m, d] = jour.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
    const n = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - n + 3);
    const a = t.getUTCFullYear(), p = new Date(Date.UTC(a, 0, 4)), s = 1 + Math.round(((t - p) / 864e5 - 3 + ((p.getUTCDay() + 6) % 7)) / 7);
    return a + '-S' + String(s).padStart(2, '0');
  }
  /** Cumul des reports par période (semaine ou mois) : reportés, payés après report, reste à encaisser. */
  function reports(lignes, pas) {
    const cle = pas === 'mois' ? (j) => j.slice(0, 7) : semaineDe;
    const g = new Map();
    lignes.filter((l) => l.jour && (l.paiement === 'REPORTE' || l.paiement === 'REPORT_PAYE')).forEach((l) => {
      const k = cle(l.jour); const r = g.get(k) || { periode: k, reportes: 0, payes: 0 };
      if (l.paiement === 'REPORTE') r.reportes++; else r.payes++;
      g.set(k, r);
    });
    let cumul = 0;
    return [...g.values()].sort((a, b) => a.periode.localeCompare(b.periode)).map((r) => { r.reste = r.reportes; cumul += r.reportes; r.cumulReste = cumul; r.total = r.reportes + r.payes; return r; });
  }
  function reportsParLogin(lignes) {
    const g = new Map();
    lignes.filter((l) => l.paiement === 'REPORTE' || l.paiement === 'REPORT_PAYE').forEach((l) => {
      const r = g.get(l.loginKey) || { loginKey: l.loginKey, login: l.login, reportes: 0, payes: 0 };
      if (l.paiement === 'REPORTE') r.reportes++; else r.payes++;
      g.set(l.loginKey, r);
    });
    return [...g.values()].sort((a, b) => b.reportes - a.reportes || a.loginKey.localeCompare(b.loginKey));
  }

  /* ============================== FACTURE (modèle Facture_exemple.pdf) ==============================
     À partir du résultat de calculB2C / calculB2B (montants HT inchangés), lignes « # | Nom | Prix unitaire | Quantité | Montant T.T.C. » :
       1. one-shot : une ligne par débit ET par prix — une vente d'avant le 17/06 payée plus tard garde l'ancien tarif
          (ex. juillet 2026 : FTTH_Home_20M à 11 800 TTC = 10 000 HT, ancienne grille) ;
       2. « PRIME DU PARTENAIRE » : prix du palier × quantité facturée (reports payés compris) ;
       3. « Prime de Performance <login> (<ventes>) », quantité 1 — B2B : ventes hors reports (base de la prime vendeur) ;
       4. B2C : prime d'atteinte de l'objectif, si elle est gagnée.
     Prix unitaire TTC = HT × (1 + TVA) ; groupe de taxe « B » ; ventilation : Total (TTC) / Imposable (HT) / Impôt. */
  const nomDebit = (d) => d.replace(/^FTTH_HOME_/, 'FTTH_Home_');
  function facture(c, opts) {
    const R = regles(opts), L = [];
    const ajoute = (nom, prixHT, quantite) => { if (quantite > 0 && prixHT > 0) L.push({ nom, prixHT, quantite, montantHT: prixHT * quantite }); };
    if (c.segment === 'B2C') {
      c.debits.forEach((d) => {
        const n = c.parDebit[d].quantite, os = c.parDebit[d].oneShot, pA = R.b2c.avant[d] || 0, pB = R.b2c.apres[d] || 0;
        const a = pA === pB ? -1 : (os - n * pB) / (pA - pB);   // nombre de ventes à l'ancien tarif (n et le one-shot du débit sont connus)
        if (Number.isInteger(a) && a >= 0 && a <= n) { ajoute(nomDebit(d), pA, a); ajoute(nomDebit(d), pB, n - a); } else ajoute(nomDebit(d), n ? os / n : 0, n);
      });
      ajoute('PRIME DU PARTENAIRE', c.prixPrimePartenaire, c.quantite);
      c.logins.filter((g) => g.primePerf > 0).forEach((g) => ajoute('Prime de Performance ' + g.login + ' (' + g.ventes + ')', g.primePerf, 1));
      ajoute('PRIME D\'ATTEINTE DE L\'OBJECTIF (' + c.objectif + ')', c.primeObjectif, 1);
    } else {
      c.debits.forEach((d) => ajoute(d, R.b2b.oneShot[d] || 0, c.totalParDebit[d] || 0));
      ajoute('PRIME DU PARTENAIRE', c.prixPrimePVT, c.payees);
      c.logins.filter((g) => g.primeVTB > 0).forEach((g) => ajoute('Prime de Performance ' + g.login + ' (' + (g.ventes - g.reports) + ')', g.primeVTB, 1));
    }
    L.forEach((l, i) => { l.n = i + 1; l.prixTTC = arrondi(l.prixHT * (1 + R.tva)); l.montantTTC = l.prixTTC * l.quantite; l.groupe = 'B'; });
    const imposable = L.reduce((s, l) => s + l.montantHT, 0), total = L.reduce((s, l) => s + l.montantTTC, 0);
    return { lignes: L, total, ventilation: { groupe: 'B - TAXABLE (' + Math.round(R.tva * 100) + ')%', total, imposable, impot: total - imposable } };
  }

  return { REGLES, cleLogin, etatPaiement, lireB2C, calculB2C, lireB2B, calculB2B, pointFinancier, reports, reportsParLogin, semaineDe, tranche, facture };
});
