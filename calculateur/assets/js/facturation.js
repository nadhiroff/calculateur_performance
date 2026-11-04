/* ============================================================================
   facturation.js — pages « Challenge » et « Facturation Celtiis » du tableau de bord interne :
   Challenge login / équipe · Facturation B2C · Facturation B2B · Point financier par login · Reports.
   Les calculs sont dans facturation_calc.js (testés : node tests/facturation.test.js).
   Source : les souscriptions déjà en base (fichier principal importé par le Tableau de bord) — aucun fichier à importer ici.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT, F = CT.fact, $ = (s, r) => (r || document).querySelector(s);
  const creer = (o) => CT.table.creer(o).el;   // CT.table.creer renvoie {el, maj}
  const mn = (n) => CT.fmt.int(n), fc = (n) => CT.fmt.fcfa(n), esc = CT.esc;

  const VUES = { challogin: 'Challenge login', chalequipe: 'Challenge équipe', factb2c: 'Facturation B2C', factb2b: 'Facturation B2B', finance: 'Point financier par login', reports: 'Reports', factdash: 'Tableau de bord des factures', factevo: 'Évolution de la facturation', factperf: 'Performance agents', factreco: 'Recommandations' };
  const S = CT.factEtat = { b2c: null, b2b: null, pas: 'semaine', params: {}, c2c: null, c2b: null, pf: null };

  /* ---------- Lecture des fichiers ---------- */
  const entetes = (ws) => { const a = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: null })[0] || []; return a.map((x) => String(x == null ? '' : x).trim().toUpperCase().replace(/\s+/g, '_')); };
  function feuilleAvec(wb, requises, preferees) {
    const noms = (preferees || []).filter((n) => wb.SheetNames.includes(n)).concat(wb.SheetNames);
    return noms.find((n) => { const h = entetes(wb.Sheets[n]); return requises.every((c) => h.includes(c)); });
  }
  async function lireClasseur(file, requises, preferees) {
    if (!window.XLSX) throw new Error('La bibliothèque Excel n\'est pas chargée (connexion Internet requise).');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const nom = feuilleAvec(wb, requises, preferees);
    if (!nom) throw new Error('Aucun onglet ne contient les colonnes attendues (' + requises.join(', ') + '). Onglets : ' + wb.SheetNames.join(', '));
    return { nom, rows: XLSX.utils.sheet_to_json(wb.Sheets[nom], { defval: null, cellDates: true }) };
  }
  async function importer(seg, file) {
    try {
      if (seg === 'b2c') {
        const { nom, rows } = await lireClasseur(file, ['DEBIT', 'PAIEMENT', 'STATUS'], ['LISTE CLIENTS COPIE', 'LISTE CLIENTS']);
        const { lignes, ignorees } = F.lireB2C(rows); S.b2c = { fichier: file.name, onglet: nom, lignes, ignorees };
      } else {
        const { nom, rows } = await lireClasseur(file, ['DEBIT', 'OBSERVATION', 'LOGIN_VENDEUR'], ['REAL']);
        const { lignes } = F.lireB2B(rows); S.b2b = { fichier: file.name, onglet: nom, lignes };
      }
      recalculer(); CT.toast('Fichier « ' + file.name + ' » analysé.', 'ok'); rendre();
    } catch (e) { CT.toast(e.message || String(e), 'err', 9000); }
  }

  /* ---------- Paramètres et calculs ---------- */
  /* Objectif FTTH du mois (prime d'atteinte de l'objectif) : automatiquement l'objectif B2C du mois facturé, Paramètres › Objectifs */
  function regles(cle) {
    const m = cle || (CT.etat && CT.etat.cle), obj = m && CT.store && CT.store.actifs ? CT.objectifs.totaux(CT.store.actifs(m).objectifs).b2c : 0;
    return { regles: { b2c: { objectif: obj > 0 ? obj : null } } };
  }
  function recalculer() {
    const o = regles();
    S.c2c = S.b2c ? F.calculB2C(S.b2c.lignes, o) : null;
    S.c2b = S.b2b ? F.calculB2B(S.b2b.lignes, o) : null;
    S.pf = S.c2c || S.c2b ? F.pointFinancier(S.c2c, S.c2b, o) : null;
  }

  /* ---------- Données : souscriptions en base (chargées par le Tableau de bord), partenaire prioritaire, mois de la date de fin ----------
     Règle (README : « OK = vente validée, VALIDE = en attente ») :
       • vente du mois en STATUS OK → « A PAYER » (facturée) ; en VALIDE → « PAIEMENT REPORTÉ » (non facturée, suivie dans Reports) ;
       • vente d'un mois antérieur passée OK ce mois-ci (DATE_UPDATE dans le mois) → « REPORT PAYÉ » (facturée) ; encore VALIDE → reportée dans son propre mois ;
       • débit FTTH_Home_* → facture B2C ; autres débits (FTTH_PRO, FIBRE_…) → facture B2B. */
  async function depuisBase() {
    const e = CT.etat;
    if (!e || !e.toutes || !e.toutes.length || !e.cle || !e.res) { if (!S.test) { S.b2c = S.b2b = null; recalculer(); } return; }
    if (S.test) return;   // données de test chargées par CT.factUI.charger
    const M = e.cle, pr = e.prioritaire, cle = M + '|' + e.jourRef + '|' + pr + '|' + e.toutes.length;
    if (S.cleBase === cle) return;
    // Fenêtre FIXE (3 mois jusqu'à la date de fin, lus en base) : la facture d'un mois ne dépend pas de la date de début affichée
    const d = await CT.analyse.donnees(); if (!d) return;
    const { b2c, b2b } = lignesFacturation(d.toutes, d.entete, M, e.jourRef, pr);
    const src = { fichier: 'Base de données', onglet: CT.date.libelleMois(M) + ' · ' + pr };
    S.b2c = b2c.length ? Object.assign({ lignes: b2c, ignorees: { sansDebit: 0 } }, src) : null;
    S.b2b = b2b.length ? Object.assign({ lignes: b2b }, src) : null;
    S.cleBase = cle; recalculer();
  }
  /** Lignes à facturer du mois M (jusqu'à jourFin) pour le partenaire pr, à partir des souscriptions en base (règle ci-dessus). */
  function lignesFacturation(toutes, entete, M, jourFin, pr) {
    const H = (entete || []).map((x) => String(x || '').trim().toUpperCase()), iDeb = H.indexOf('DEBIT'), iUpd = H.indexOf('DATE_UPDATE');
    const debut = M + '-01', idx = CT.objectifs.indexLogins(CT.store.actifs(M).objectifs), b2c = [], b2b = [];
    toutes.forEach((l) => {
      if (l.partenaire !== pr || !l.jour || l.jour > jourFin) return;
      const debit = String((l.brut || [])[iDeb] == null ? '' : l.brut[iDeb]).trim(), upd = String((l.brut || [])[iUpd] || '').slice(0, 7);
      if (!debit) return;
      let paiement;
      if (l.jour >= debut) paiement = l.statut === 'OK' ? 'PAYE' : l.statut === 'VALIDE' ? 'REPORTE' : 'NON_VALIDE';
      else if (l.statut === 'OK' && upd === M) paiement = 'REPORT_PAYE';
      else return;   // vente d'un mois antérieur : déjà facturée dans son mois, ou encore en attente (reportée dans SON mois)
      const o = idx.get(l.loginKey), base = { login: l.login, loginKey: l.loginKey, jour: l.jour, equipe: o ? o.equipe : '' };
      if (/^FTTH_HOME_/i.test(debit)) b2c.push(Object.assign(base, { debit, paiement }));
      else b2b.push(Object.assign(base, { debit: debit.toUpperCase().replace(/\s+/g, '_'), partenaire: pr, typeVente: paiement === 'REPORT_PAYE' ? 'Report' : M,
        paiement: paiement === 'REPORT_PAYE' ? 'PAYE' : paiement }));
    });
    return { b2c, b2b };
  }

  /* ---------- Éléments communs ---------- */
  const nomLogin = (k) => (CT.loginCourt ? CT.loginCourt(k) : k);
  const alertes = (l) => (l && l.length ? `<ul class="alerts">${l.map((a) => `<li class="alert ${a.niveau === 'warn' ? 'alerte' : 'info'}"><span class="alert-ic"><i class="fa-solid fa-triangle-exclamation"></i></span><div><strong>${esc(a.titre)}</strong><span>${esc(a.detail)}</span></div></li>`).join('')}</ul>` : '');
  function zoneImport(seg, titre, aide) {
    const d = S[seg];
    return `<section class="card no-print"><div class="card-head"><div><h3>${esc(titre)}</h3><p>${aide}</p></div></div>
      <div class="import-row"><label class="btn btn-primary" for="fi-${seg}"><i class="fa-solid fa-file-import" aria-hidden="true"></i>${d ? 'Remplacer le fichier' : 'Importer le fichier'}</label>
      <input type="file" id="fi-${seg}" data-seg="${seg}" accept=".xlsx,.xlsm,.xls" class="sr-only">
      ${d ? `<span class="muted"> ${esc(d.fichier)} · onglet « ${esc(d.onglet)} » · ${mn(d.lignes.length)} lignes lues</span>` : '<span class="muted"> Aucun fichier importé.</span>'}</div></section>`;
  }
  function zoneBase(seg) {
    const e = CT.etat, d = S[seg], n = (p) => (d ? d.lignes.filter((l) => l.paiement === p).length : 0);
    return `<section class="card no-print fact-source"><div class="card-head"><div><h3>Données de ${e && e.cle ? esc(CT.date.libelleMois(e.cle)) : '—'} · ${esc((e && e.prioritaire) || '')}</h3>
      <p>Calculé depuis les souscriptions en base (fichier principal importé par le Tableau de bord), du 1er au ${e && e.jourRef ? CT.date.court(e.jourRef) : '—'}. Ventes <b>OK</b> = à payer ; <b>VALIDE</b> = paiement reporté ; vente d'un mois précédent passée OK ce mois-ci = report payé. Changez la date de fin (en haut) pour un autre mois.</p></div></div>
      <p class="muted">${seg.toUpperCase()} : ${mn(n('PAYE'))} à payer · ${mn(n('REPORT_PAYE'))} report(s) payé(s) · ${mn(n('REPORTE'))} reportée(s)</p></section>`;
  }
  function vide(seg, texte) { return `<div class="card empty"><i class="fa-solid fa-file-import" aria-hidden="true"></i><h3>Aucune donnée pour le moment</h3><p>${texte}</p></div>`; }
  function tuiles(l) { return `<div class="grid-tuiles fact-tuiles">${l.map((t) => CT.ui.tuile(t)).join('')}</div>`; }
  function bouton(id, icone, texte) { return `<button class="btn btn-secondary btn-sm" type="button" id="${id}"><i class="fa-solid ${icone}" aria-hidden="true"></i>${texte}</button>`; }
  function telecharger(nom, defs) { CT.telecharger(CT.export.blobXlsx(defs), nom + '.xlsx'); }   // même téléchargement que la barre d'export

  /* ---------- Facture au modèle Facture_exemple.pdf : # | Nom | Prix unitaire | Quantité | Montant T.T.C. [B], puis ventilation des impôts ---------- */
  // Mois facturé : le plus fréquent parmi les ventes payées du fichier (ex. « SEPTEMBRE 2026 »)
  function moisFacture(seg) {
    const f = new Map(); ((S[seg] || {}).lignes || []).forEach((l) => { if (l.paiement === 'PAYE' && l.jour) f.set(l.jour.slice(0, 7), (f.get(l.jour.slice(0, 7)) || 0) + 1); });
    const cle = [...f.entries()].sort((a, b) => b[1] - a[1])[0];
    return cle ? CT.date.libelleMois(cle[0]).toUpperCase() : '';
  }
  const titreFacture = (seg) => ('COMMISSION FTTH RGZ ' + seg.toUpperCase() + ' ' + moisFacture(seg)).trim();
  function factureHTML(f, titre) {
    const n = CT.fmt.mnt;
    return `<p><b>${esc(titre)}</b></p>
      <div class="table-wrap"><table class="table-compact facture"><caption class="sr-only">${esc(titre)}</caption>
        <colgroup><col style="width:44px"><col><col style="width:16%"><col style="width:11%"><col style="width:20%"></colgroup>
        <thead><tr><th scope="col" class="num">N°</th><th scope="col">Nom</th><th scope="col" class="num">Prix unitaire</th><th scope="col" class="num">Quantité</th><th scope="col" class="num">Montant T.T.C.</th></tr></thead>
        <tbody>${f.lignes.map((l) => `<tr><td class="num">${l.n}</td><td>${esc(l.nom)}</td><td class="num">${n(l.prixTTC)}</td><td class="num">${n(l.quantite)}</td><td class="num">${n(l.montantTTC)} [${l.groupe}]</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted" style="margin-top:16px">--- VENTILATION DES IMPÔTS ---</p>
      <div class="table-wrap" style="max-width:560px"><table class="table-compact facture facture-tva"><caption class="sr-only">Ventilation des impôts</caption>
        <thead><tr><th scope="col">Groupe</th><th scope="col" class="num">Total</th><th scope="col" class="num">Imposable</th><th scope="col" class="num">Impôt</th></tr></thead>
        <tbody><tr><td>${esc(f.ventilation.groupe)}</td><td class="num">${n(f.ventilation.total)}</td><td class="num">${n(f.ventilation.imposable)}</td><td class="num">${n(f.ventilation.impot)}</td></tr></tbody>
      </table></div>
      <p class="num" style="text-align:right;font-size:1.25rem;letter-spacing:.08em;margin-top:12px"><b>Total : ${n(f.total)}</b></p>
      <p class="muted">Total HT (imposable) ${fc(f.ventilation.imposable)} · TVA 18 % ${fc(f.ventilation.impot)} · Total TTC ${fc(f.total)}</p>`;
  }
  /* Feuille Excel de la facture : en-tête gris, ligne TOTAL TTC en gras sur gris, ventilation avec son sous-en-tête gris */
  const factureDef = (f, titre) => {
    const aoa = [['N°', 'Nom', 'Prix unitaire', 'Quantité', 'Montant T.T.C.']].concat(f.lignes.map((l) => [l.n, l.nom, l.prixTTC, l.quantite, l.montantTTC]),
      [['TOTAL TTC', '', '', '', f.total], [], ['VENTILATION DES IMPÔTS'], ['Groupe', 'Total', 'Imposable', 'Impôt'], [f.ventilation.groupe, f.ventilation.total, f.ventilation.imposable, f.ventilation.impot], [], [titre]]);
    return { aoa, entetes: [f.lignes.length + 4], total: false, filtre: false };
  };

  /* ---------- Facturation B2C ---------- */
  function feuillesB2C() {
    const c = S.c2c, deb = c.debits;
    return [
      Object.assign({ nom: 'Facture B2C', cols: [12, 52, 14, 10, 18] }, factureDef(F.facture(c, regles()), titreFacture('b2c'))),
      { nom: 'B2C par login', cols: [26, 14, 10, 10].concat(deb.map(() => 12), [14, 14, 14, 16, 16]),
        aoa: [['Login', 'Équipe', 'Ventes', 'dont reports'].concat(deb, ['One-shot (FCFA)', 'Part vendeur (FCFA)', 'Part partenaire (FCFA)', 'Prime perf. (FCFA)', 'Total vendeur (FCFA)'])]
          .concat(c.logins.map((g) => [g.login, g.equipe, g.ventes, g.reports].concat(deb.map((d) => g.parDebit[d] || 0), [g.oneShot, g.partVendeur, g.partPartenaire, g.primePerf, g.total]))) },
    ];
  }
  function vueB2C() {
    const root = $('#factb2c-content'), c = S.c2c;
    const imp = zoneBase('b2c');
    if (!c) { root.innerHTML = imp + vide('b2c', 'Aucune vente FTTH Home du partenaire sur ce mois en base. Importez le fichier principal depuis le Tableau de bord.'); return; }
    const params = '';
    root.innerHTML = imp + `<div class="stack">${alertes(c.alertes)}
      ${tuiles([
        { icone: 'fa-wifi', ton: 'pos', titre: 'Ventes facturables', valeur: mn(c.quantite), aide: Object.keys(c.parDebit).map((d) => mn(c.parDebit[d].quantite) + ' × ' + d.replace('FTTH_HOME_', '')).join(' · ') + (c.reportsPayes ? ' · dont ' + mn(c.reportsPayes) + ' report(s) payé(s)' : '') },
        { icone: 'fa-coins', titre: 'One-shot', valeur: fc(c.oneShot), aide: 'Vendeurs ' + fc(c.partVendeurs) + ' · Partenaire ' + fc(c.partPartenaire) },
        { icone: 'fa-medal', ton: 'warn', titre: 'Primes', valeur: fc(c.primeVendeurs + c.primePartenaire + c.primeObjectif), aide: 'Vendeurs ' + fc(c.primeVendeurs) + ' · Partenaire ' + fc(c.primePartenaire) + ' · Objectif ' + fc(c.primeObjectif) },
        { icone: 'fa-file-invoice-dollar', ton: 'pos', titre: 'Total HT à facturer', valeur: fc(c.totalHT), aide: 'TTC (TVA 18 %) : ' + fc(c.totalTTC) }])}
      ${c.objectif == null ? CT.ui.enClair('La <b>prime d\'atteinte de l\'objectif</b> n\'est pas calculée : aucun objectif B2C pour ce mois dans Paramètres › Objectifs.', 'fa-circle-info') : CT.ui.enClair(c.objectifAtteint ? 'Objectif de <b>' + mn(c.objectif) + '</b> ventes atteint : prime de <b>' + fc(c.primeObjectif) + '</b>.' : 'Objectif de <b>' + mn(c.objectif) + '</b> ventes non atteint (' + mn(c.quantite) + ' réalisées) : pas de prime d\'objectif.', c.objectifAtteint ? 'fa-face-smile' : 'fa-triangle-exclamation')}
      ${CT.ui.enClair('Non facturées : <b>' + mn(c.nonPayes.reportes) + '</b> ventes au paiement reporté et <b>' + mn(c.nonPayes.nonValides) + '</b> ventes non validées.', 'fa-hourglass-half')}
      ${params}
      <section class="card"><div class="card-head"><div><h3>Facture B2C</h3><p>Modèle de la facture normalisée : prix et montants TTC (TVA 18 %), puis ventilation HT / impôt</p></div>${bouton('xl-b2c', 'fa-file-excel', 'Excel')}</div><div id="tb-fb2c"></div></section>
      <section class="card"><div class="card-head"><div><h3>Commissions par login</h3><p>Quantités par débit, one-shot (80 % vendeur / 20 % partenaire) et prime de performance</p></div></div><div id="tb-lb2c"></div></section></div>`;
    const deb = c.debits;
    $('#tb-fb2c').innerHTML = factureHTML(F.facture(c, regles()), titreFacture('b2c'));
    $('#tb-lb2c').append(creer({ pageSize: 15, recherche: true, caption: 'Commissions B2C par login', lignes: c.logins, triInit: { cle: 'ventes', dir: 'desc' }, classeLigne: (g) => (g.anonymat ? 'row-hors' : ''),
      colonnes: [{ cle: 'login', titre: 'Login', fmt: (v, g) => nomLogin(g.loginKey) + (g.anonymat ? ' (Anonymat)' : '') }, { cle: 'equipe', titre: 'Équipe' }, { cle: 'ventes', titre: 'Ventes', num: true, fmt: mn }]
        .concat(deb.map((d) => ({ cle: 'd_' + d, titre: d.replace('FTTH_HOME_', ''), num: true, tri: (g) => g.parDebit[d] || 0, fmt: (v, g) => mn(g.parDebit ? g.parDebit[d] || 0 : v) })),
          [{ cle: 'oneShot', titre: 'One-shot (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'partVendeur', titre: 'Part vendeur (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'primePerf', titre: 'Prime perf. (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'total', titre: 'Total vendeur (FCFA)', num: true, html: true, fmt: (v) => '<b>' + CT.fmt.mnt(v) + '</b>' }]),
      pied: { login: 'TOTAL', ventes: c.quantite, oneShot: c.oneShot, partVendeur: c.partVendeurs, primePerf: c.primeVendeurs, total: c.partVendeurs + c.primeVendeurs } }));
  }

  /* ---------- Facturation B2B ---------- */
  function vueB2B() {
    const root = $('#factb2b-content'), c = S.c2b;
    const imp = zoneBase('b2b');
    if (!c) { root.innerHTML = imp + vide('b2b', 'Aucune vente B2B (FTTH_PRO, FIBRE…) du partenaire sur ce mois en base.'); return; }
    root.innerHTML = imp + `<div class="stack">${alertes(c.alertes)}
      ${tuiles([
        { icone: 'fa-building', ton: 'pos', titre: 'Ventes payées', valeur: mn(c.payees), aide: 'Dont ' + mn(c.reportsPayes) + ' report(s) payé(s) · ' + mn(c.nonPayes.reportes) + ' paiement(s) reporté(s) non facturé(s)' },
        { icone: 'fa-coins', titre: 'Commissions', valeur: fc(c.commVTB + c.commPVT), aide: 'Vendeurs (80 %) ' + fc(c.commVTB) + ' · Partenaire (20 %) ' + fc(c.commPVT) },
        { icone: 'fa-medal', ton: 'warn', titre: 'Primes', valeur: fc(c.primeVTB + c.primePVT), aide: 'Vendeurs ' + fc(c.primeVTB) + ' · Partenaire ' + fc(c.primePVT) + ' (' + mn(c.prixPrimePVT) + ' × ' + mn(c.payees) + ')' },
        { icone: 'fa-file-invoice-dollar', ton: 'pos', titre: 'Total HT à facturer', valeur: fc(c.totalHT), aide: 'TTC (TVA 18 %) : ' + fc(c.totalTTC) }])}
      ${CT.ui.enClair('La prime vendeur se calcule sur les ventes payées <b>hors reports</b> ; la prime partenaire sur <b>toutes</b> les ventes payées (reports compris). Mois de vente : <b>' + esc(c.moisVente) + '</b>.', 'fa-circle-info')}
      <section class="card"><div class="card-head"><div><h3>Facture B2B</h3><p>Modèle de la facture normalisée : one-shot par offre, prime du partenaire, primes de performance des vendeurs (hors reports)</p></div>${bouton('xl-fb2b', 'fa-file-excel', 'Excel')}</div><div id="tb-fb2b"></div></section>
      <section class="card"><div class="card-head"><div><h3>Récapitulatif B2B par login</h3><p>Équivalent des onglets COMM et RECAP du fichier de facturation</p></div>${bouton('xl-b2b', 'fa-file-excel', 'Excel')}</div><div id="tb-lb2b"></div></section></div>`;
    $('#tb-fb2b').innerHTML = factureHTML(F.facture(c, regles()), titreFacture('b2b'));
    $('#tb-lb2b').append(creer({ pageSize: 15, recherche: true, caption: 'Facturation B2B par login', lignes: c.logins, triInit: { cle: 'ventes', dir: 'desc' }, classeLigne: (g) => (g.anonymat ? 'row-hors' : ''),
      colonnes: [{ cle: 'login', titre: 'Login', fmt: (v, g) => nomLogin(g.loginKey) + (g.anonymat ? ' (Anonymat)' : '') }].concat(c.debits.map((d) => ({ cle: 'd_' + d, titre: d.replace(/^FIBRE_|^FTTH_/, ''), num: true, tri: (g) => g.parDebit[d] || 0, fmt: (v, g) => mn(g.parDebit ? g.parDebit[d] || 0 : v) })),
        [{ cle: 'ventes', titre: 'Ventes', num: true, fmt: mn }, { cle: 'reports', titre: 'dont reports', num: true, fmt: mn }, { cle: 'commVTB', titre: 'Comm. vendeur (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'primeVTB', titre: 'Prime vendeur (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'totalVTB', titre: 'Total vendeur HT (FCFA)', num: true, html: true, fmt: (v) => '<b>' + CT.fmt.mnt(v) + '</b>' }, { cle: 'commPVT', titre: 'Comm. partenaire (FCFA)', num: true, fmt: CT.fmt.mnt }]),
      pied: Object.assign({ login: 'TOTAL', ventes: c.payees, reports: c.reportsPayes, commVTB: c.commVTB, primeVTB: c.primeVTB, totalVTB: c.commVTB + c.primeVTB, commPVT: c.commPVT }, ...c.debits.map((d) => ({ ['d_' + d]: c.totalParDebit[d] }))) }));
  }
  function feuillesB2B() {
    const c = S.c2b;
    return [
      Object.assign({ nom: 'Facture B2B', cols: [12, 52, 14, 10, 18] }, factureDef(F.facture(c, regles()), titreFacture('b2b'))),
      { nom: 'RECAP B2B', cols: [34, 18], aoa: [['Rubrique', 'Montant HT (FCFA)'], ['Ventes payées', c.payees], ['dont reports payés', c.reportsPayes], ['Commission vendeur', c.commVTB], ['Prime vendeur', c.primeVTB], ['Commission partenaire', c.commPVT], ['Prime partenaire (' + mn(c.prixPrimePVT) + ' × ' + mn(c.payees) + ')', c.primePVT], ['Total HT', c.totalHT], ['TVA 18 %', c.tva], ['Total TTC', c.totalTTC]], total: false },
      { nom: 'COMM B2B', cols: [26].concat(c.debits.map(() => 14), [10, 12, 16, 16, 18, 18]),
        aoa: [['Login'].concat(c.debits, ['Ventes', 'dont reports', 'Comm. vendeur (FCFA)', 'Prime vendeur (FCFA)', 'Total vendeur HT (FCFA)', 'Comm. partenaire (FCFA)'])]
          .concat(c.logins.map((g) => [g.login].concat(c.debits.map((d) => g.parDebit[d] || 0), [g.ventes, g.reports, g.commVTB, g.primeVTB, g.totalVTB, g.commPVT]))) },
    ];
  }

  /* ---------- Point financier par login ---------- */
  function vueFinance() {
    const root = $('#finance-content'), p = S.pf;
    const note = (S.b2c ? '' : '<li>Fichier B2C non importé.</li>') + (S.b2b ? '' : '<li>Fichier B2B non importé.</li>');
    if (!p) { root.innerHTML = vide('', 'Aucune vente du partenaire sur ce mois en base. Importez le fichier principal depuis le Tableau de bord.') + `<p class="muted"><a href="#facturation-b2c">Aller à la facturation B2C</a> · <a href="#facturation-b2b">Aller à la facturation B2B</a></p>`; return; }
    const t = p.totaux;
    root.innerHTML = `<div class="stack">${note ? `<ul class="muted">${note}</ul>` : ''}
      ${tuiles([
        { icone: 'fa-users', titre: 'Logins payés', valeur: mn(p.lignes.length), aide: mn(t.ventes) + ' ventes (B2C + B2B)' },
        { icone: 'fa-coins', titre: 'One-shot', valeur: fc(t.oneShot), aide: 'Commerciaux ' + fc(t.partCommercial) + ' · RGZ ' + fc(t.partRGZ) },
        { icone: 'fa-medal', ton: 'warn', titre: 'Primes de performance', valeur: fc(t.primes), aide: 'Primes vendeurs B2C + B2B' },
        { icone: 'fa-money-bill-wave', ton: 'pos', titre: 'Net à payer aux commerciaux', valeur: fc(t.net), aide: 'après AIB 5 % : ' + fc(t.aib) }])}
      ${CT.ui.enClair('Le commercial perçoit <b>80 %</b> du one-shot et RGZ <b>20 %</b>. Les logins <b>Anonymat</b> perçoivent <b>100 %</b> du one-shot en plus de leur prime de performance. L\'AIB de <b>5 %</b> est retenu sur la part du commercial, pour <b>tous les logins</b>.', 'fa-circle-info')}
      <section class="card"><div class="card-head"><div><h3>Point financier par login</h3><p>Ventes payées + reports payés · B2C et B2B réunis</p></div>${bouton('xl-fin', 'fa-file-excel', 'Excel')}</div><div id="tb-fin"></div></section></div>`;
    $('#tb-fin').append(creer({ pageSize: 20, recherche: true, caption: 'Point financier par login', lignes: p.lignes, triInit: { cle: 'net', dir: 'desc' }, classeLigne: (g) => (g.anonymat ? 'row-hors' : ''),
      colonnes: [{ cle: 'login', titre: 'Login', fmt: (v, g) => nomLogin(g.loginKey) + (g.anonymat ? ' (Anonymat)' : '') }, { cle: 'equipe', titre: 'Équipe' }, { cle: 'ventesB2C', titre: 'Ventes B2C', num: true, fmt: mn }, { cle: 'ventesB2B', titre: 'Ventes B2B', num: true, fmt: mn },
        { cle: 'oneShot', titre: 'One-shot (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'partCommercial', titre: 'Part commercial (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'partRGZ', titre: 'Part RGZ (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'aib', titre: 'AIB 5 % (FCFA)', num: true, fmt: CT.fmt.mnt },
        { cle: 'primes', titre: 'Primes (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'net', titre: 'Net à payer (FCFA)', num: true, html: true, fmt: (v) => '<b>' + CT.fmt.mnt(v) + '</b>' }],
      pied: { login: 'TOTAL', ventesB2C: p.lignes.reduce((s, g) => s + g.ventesB2C, 0), ventesB2B: p.lignes.reduce((s, g) => s + g.ventesB2B, 0), oneShot: t.oneShot, partCommercial: t.partCommercial, partRGZ: t.partRGZ, aib: t.aib, primes: t.primes, net: t.net } }));
  }
  function feuillesFinance() {
    const p = S.pf;
    return [{ nom: 'Point financier', cols: [26, 14, 10, 10, 16, 18, 16, 14, 14, 18],
      aoa: [['Login', 'Équipe', 'Ventes B2C', 'Ventes B2B', 'One-shot (FCFA)', 'Part commercial (FCFA)', 'Part RGZ (FCFA)', 'AIB (FCFA)', 'Primes (FCFA)', 'Net à payer (FCFA)']]
        .concat(p.lignes.map((g) => [g.login + (g.anonymat ? ' (Anonymat)' : ''), g.equipe, g.ventesB2C, g.ventesB2B, g.oneShot, g.partCommercial, g.partRGZ, g.aib, g.primes, g.net])) }];
  }

  /* ---------- Reports ---------- */
  /** Libellé lisible d'une période de report : « 2026-S40 » → « Semaine 40 · 28/09 → 04/10/2026 » ; « 2026-10 » → « Octobre 2026 ». */
  function libPeriode(c) {
    const m = /^(\d{4})-S(\d{1,2})$/.exec(String(c));
    if (!m) return /^\d{4}-\d{2}$/.test(c) ? CT.date.libelleMois(c) : String(c);
    const a = +m[1], n = +m[2], j4 = new Date(Date.UTC(a, 0, 4)), lundi = new Date(j4.getTime() - ((j4.getUTCDay() + 6) % 7) * 864e5 + (n - 1) * 7 * 864e5), dim = new Date(lundi.getTime() + 6 * 864e5);
    const f = (d) => String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0'), an = (d) => '/' + d.getUTCFullYear();
    return 'Semaine ' + n + ' · ' + f(lundi) + (lundi.getUTCFullYear() !== dim.getUTCFullYear() ? an(lundi) : '') + ' → ' + f(dim) + an(dim);
  }
  CT.libPeriodeReport = libPeriode;
  function vueReports() {
    const root = $('#reports-content');
    const L = (S.b2c ? S.b2c.lignes : []).concat(S.b2b ? S.b2b.lignes : []);
    if (!L.length) { root.innerHTML = vide('', 'Aucune vente du partenaire sur ce mois en base. Importez le fichier principal depuis le Tableau de bord.'); return; }
    const par = F.reports(L, S.pas), logins = F.reportsParLogin(L);
    const tot = par.reduce((s, r) => ({ r: s.r + r.reportes, p: s.p + r.payes }), { r: 0, p: 0 });
    root.innerHTML = `<div class="stack">
      ${tuiles([{ icone: 'fa-clock-rotate-left', ton: tot.r ? 'warn' : 'pos', titre: 'Reports en attente', valeur: mn(tot.r), aide: 'Ventes dont le paiement est reporté' }, { icone: 'fa-circle-check', ton: 'pos', titre: 'Reports payés', valeur: mn(tot.p), aide: 'Ventes reportées puis payées' }, { icone: 'fa-users', titre: 'Logins concernés', valeur: mn(logins.filter((l) => l.reportes).length), aide: 'Avec au moins un report en attente' }])}
      <section class="card"><div class="card-head"><div><h3>Cumul des reports</h3><p>Par ${S.pas === 'mois' ? 'mois' : 'semaine'} de vente · B2C et B2B${S.pas === 'mois' ? '' : ' · « Semaine 40 » = 40e semaine de l\'année, du lundi au dimanche (norme ISO)'}</p></div>
        <div class="no-print" style="display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap"><select class="select input-sm" id="rp-pas" aria-label="Période de comparaison" style="width:auto"><option value="semaine" ${S.pas === 'semaine' ? 'selected' : ''}>Hebdomadaire</option><option value="mois" ${S.pas === 'mois' ? 'selected' : ''}>Mensuel</option></select>${bouton('xl-rp', 'fa-file-excel', 'Excel')}</div></div><div id="tb-rp"></div></section>
      <section class="card"><div class="card-head"><div><h3>Reports par login</h3><p>Ventes reportées et payées après report</p></div></div><div id="tb-rpl"></div></section></div>`;
    $('#tb-rp').append(creer({ pageSize: 0, caption: 'Cumul des reports', lignes: par, triInit: { cle: 'periode', dir: 'asc' },
      colonnes: [{ cle: 'periode', titre: S.pas === 'mois' ? 'Mois' : 'Semaine (du lundi au dimanche)', fmt: libPeriode }, { cle: 'reportes', titre: 'Reportés', num: true, fmt: mn }, { cle: 'payes', titre: 'Payés après report', num: true, fmt: mn }, { cle: 'cumulReste', titre: 'Cumul en attente', num: true, fmt: mn }],
      pied: { periode: 'TOTAL', reportes: tot.r, payes: tot.p } }));
    $('#tb-rpl').append(creer({ pageSize: 15, recherche: true, caption: 'Reports par login', lignes: logins, triInit: { cle: 'reportes', dir: 'desc' },
      colonnes: [{ cle: 'login', titre: 'Login', fmt: (v, g) => nomLogin(g.loginKey) }, { cle: 'reportes', titre: 'Reportés', num: true, fmt: mn }, { cle: 'payes', titre: 'Payés après report', num: true, fmt: mn }], pied: { login: 'TOTAL', reportes: tot.r, payes: tot.p } }));
  }

  /* ---------- Challenges (données du fichier de souscriptions déjà importé) ---------- */
  function donneesChallenge() {
    const e = CT.etat; if (!e.lignes.length) return null;
    const R = e.motiv.regles, compte = (l) => (R.statuts_comptes || ['OK']).includes(l.statut), p = CT.dashboard.periodeDash();
    const idx = CT.objectifs.indexLogins(e.motiv.objectifs), debutMois = e.cle + '-01';
    const L = e.lignes.filter((l) => l.partenaire === e.prioritaire && compte(l) && l.jour && l.jour >= p.du && l.jour <= p.au);
    const Lm = e.lignes.filter((l) => l.partenaire === e.prioritaire && compte(l) && l.jour && l.jour >= debutMois && l.jour <= e.jourRef);
    return { e, p, idx, L, Lm };
  }
  function vueChallenge(type) {
    const root = $(type === 'login' ? '#challogin-content' : '#chalequipe-content'), d = donneesChallenge();
    if (!d) { root.innerHTML = vide('', 'Importez le fichier de souscriptions (Tableau de bord) pour afficher le challenge.'); return; }
    const periode = 'du ' + CT.date.court(d.p.du) + ' au ' + CT.date.court(d.p.au), e = d.e;
    const eq = (k) => (d.idx.get(k) || {}).equipe || 'À préciser';
    let lignes;
    if (type === 'login') {
      const m = new Map();
      d.L.forEach((l) => { const g = m.get(l.loginKey) || { cle: l.loginKey, equipe: eq(l.loginKey), n: 0, b2c: 0, b2b: 0 }; g.n++; if (l.segment === 'B2B') g.b2b++; else g.b2c++; m.set(l.loginKey, g); });
      const mois = new Map(); d.Lm.forEach((l) => mois.set(l.loginKey, (mois.get(l.loginKey) || 0) + 1));
      lignes = [...m.values()].map((g) => { const o = (d.idx.get(g.cle) || {}).mois || 0, r = mois.get(g.cle) || 0; return Object.assign(g, { objMois: o, realMois: r, taux: o > 0 ? r / o : null }); });
    } else {
      const m = new Map();
      d.L.forEach((l) => { const k = eq(l.loginKey), g = m.get(k) || { cle: k, equipe: k, n: 0, b2c: 0, b2b: 0, logins: new Set() }; g.n++; g.logins.add(l.loginKey); if (l.segment === 'B2B') g.b2b++; else g.b2c++; m.set(k, g); });
      const mois = new Map(); d.Lm.forEach((l) => { const k = eq(l.loginKey); mois.set(k, (mois.get(k) || 0) + 1); });
      e.motiv.objectifs.equipes.forEach((q) => { if (!m.has(q.id)) m.set(q.id, { cle: q.id, equipe: q.id, n: 0, b2c: 0, b2b: 0, logins: new Set() }); });
      lignes = [...m.values()].map((g) => { const q = e.motiv.objectifs.equipes.find((x) => x.id === g.cle), o = q ? CT.objectifs.moisEq(q) : 0, r = mois.get(g.cle) || 0; return Object.assign(g, { nbLogins: g.logins.size, objMois: o, realMois: r, taux: o > 0 ? r / o : null }); });
    }
    lignes.sort((a, b) => b.n - a.n || (b.taux || 0) - (a.taux || 0)).forEach((g, i) => { g.rang = i + 1; });
    const top = lignes.slice(0, 3);
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair('Classement ' + (type === 'login' ? 'des vendeurs' : 'des équipes') + ' <b>' + esc(e.prioritaire) + '</b> par ventes validées, ' + periode + '. L\'objectif et le réalisé sont ceux du mois de ' + esc(CT.date.libelleMois(e.cle).toLowerCase()) + ' (au ' + CT.date.court(e.jourRef) + ').', 'fa-trophy')}
      ${top.length ? `<ol class="podium">${top.map((g, i) => `<li class="${['or', 'argent', 'bronze'][i]}"><span class="podium-rang" aria-hidden="true">${i + 1}</span><div><b>${esc(type === 'login' ? nomLogin(g.cle) : g.cle)}</b><small>${type === 'login' ? esc(g.equipe) + ' · ' : ''}${mn(g.n)} ventes</small></div></li>`).join('')}</ol>` : ''}
      <section class="card"><div class="card-head"><div><h3>Challenge ${type === 'login' ? 'par login' : 'par équipe'}</h3><p>${periode}</p></div>${bouton('xl-ch', 'fa-file-excel', 'Excel')}</div><div id="tb-ch"></div></section></div>`;
    S.chDef = { nom: 'Challenge ' + (type === 'login' ? 'login' : 'équipe'), cols: [8, 26, 16, 10, 10, 10, 14, 14, 14], aoa: [['Rang', type === 'login' ? 'Login' : 'Équipe', 'Équipe', 'Ventes', 'B2C', 'B2B', 'Objectif du mois', 'Réalisé du mois', '% objectif du mois']].concat(lignes.map((g) => [g.rang, type === 'login' ? g.cle : g.cle, g.equipe, g.n, g.b2c, g.b2b, g.objMois, g.realMois, g.taux == null ? '' : g.taux])), total: false };
    $('#tb-ch').append(creer({ pageSize: 20, recherche: true, caption: 'Challenge', lignes, triInit: { cle: 'rang', dir: 'asc' },
      colonnes: [{ cle: 'rang', titre: 'Rang', num: true }, { cle: 'cle', titre: type === 'login' ? 'Login' : 'Équipe', fmt: (v) => (type === 'login' ? nomLogin(v) : v) }].concat(type === 'login' ? [{ cle: 'equipe', titre: 'Équipe' }] : [{ cle: 'nbLogins', titre: 'Vendeurs actifs', num: true, fmt: mn }],
        [{ cle: 'n', titre: 'Ventes', num: true, html: true, fmt: (v) => '<b>' + mn(v) + '</b>' }, { cle: 'b2c', titre: 'B2C', num: true, fmt: mn }, { cle: 'b2b', titre: 'B2B', num: true, fmt: mn }, { cle: 'objMois', titre: 'Objectif du mois', num: true, fmt: mn }, { cle: 'realMois', titre: 'Réalisé du mois', num: true, fmt: mn },
          { cle: 'taux', titre: '% objectif', num: true, tri: (g) => (g.taux == null ? -1 : g.taux), fmt: (v, g) => (g.taux == null ? '—' : CT.fmt.pct(g.taux, 0)) }]) }));
  }

  /* ---------- Rendu et événements ---------- */
  /* ======================= TABLEAU DE BORD, ÉVOLUTION, PERFORMANCE AGENTS, RECOMMANDATIONS =======================
     Mêmes montants que les factures (facturation_calc.js), mois de la date de fin ; rien n'est recalculé autrement.
     Reversé aux vendeurs = part vendeurs (80 %, Anonymat 100 %) + primes vendeurs ; net RGZ = part RGZ + primes partenaire + prime d'objectif. */
  const vide2 = (t) => `<div class="card empty"><i class="fa-solid fa-file-invoice-dollar" aria-hidden="true"></i><h3>Aucune donnée pour le moment</h3><p>${t}</p></div>`;
  const pcx = (x, d = 1) => CT.fmt.pct(x, d);
  /** Synthèse d'un mois à partir des résultats B2C / B2B du moteur. */
  function synthese(c2c, c2b) {
    const z = { quantite: 0, reportes: 0, oneShot: 0, partVendeurs: 0, partPartenaire: 0, primeVendeurs: 0, primePartenaire: 0, primeObjectif: 0, totalHT: 0, totalTTC: 0 };
    const b = c2c || z, d = c2b || { payees: 0, nonPayes: { reportes: 0 }, commVTB: 0, commPVT: 0, primeVTB: 0, primePVT: 0, totalHT: 0, totalTTC: 0 };
    const r = {
      ventesB2C: b.quantite || 0, ventesB2B: d.payees || 0, reportes: ((b.nonPayes || {}).reportes || 0) + ((d.nonPayes || {}).reportes || 0),
      htB2C: b.totalHT || 0, htB2B: d.totalHT || 0, ttc: (b.totalTTC || 0) + (d.totalTTC || 0),
      partRgzB2C: b.partPartenaire || 0, partRgzB2B: d.commPVT || 0, primePartB2C: b.primePartenaire || 0, primePartB2B: d.primePVT || 0, primeObjectif: b.primeObjectif || 0,
      vendeursB2C: (b.partVendeurs || 0) + (b.primeVendeurs || 0), vendeursB2B: (d.commVTB || 0) + (d.primeVTB || 0),
      oneShotB2C: b.oneShot || 0, oneShotB2B: (d.commVTB || 0) + (d.commPVT || 0), primesVendB2C: b.primeVendeurs || 0, primesVendB2B: d.primeVTB || 0 };
    r.ventes = r.ventesB2C + r.ventesB2B; r.ht = r.htB2C + r.htB2B; r.tva = r.ttc - r.ht;
    r.netRgz = r.partRgzB2C + r.partRgzB2B + r.primePartB2C + r.primePartB2B + r.primeObjectif; r.vendeurs = r.vendeursB2C + r.vendeursB2B;
    return r;
  }
  const moisFact = () => (CT.etat && CT.etat.cle ? CT.date.libelleMois(CT.etat.cle) + ' · du 1er au ' + CT.date.court(CT.etat.jourRef) : '');
  const deMois = (t) => (/^[aeiouyhâ]/i.test(t) ? 'd\'' : 'de ') + t.charAt(0).toLowerCase() + t.slice(1);   // « d'octobre 2026 », « de septembre 2026 »

  function vueDash() {
    const root = $('#factdash-content'), c = S.c2c, d = S.c2b;
    if (!c && !d) { root.innerHTML = zoneBase('b2c') + vide2('Aucune vente du partenaire sur ce mois en base. Importez le fichier principal depuis le Tableau de bord.'); return; }
    const r = synthese(c, d), A = CT.analyse, pr = CT.etat.prioritaire;
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair('Factures du mois de la date de fin (' + esc(moisFact()) + '), calculées depuis les ventes en base : mêmes montants que les pages Facture B2C et Facture B2B.', 'fa-circle-info')}
      <div class="grid-kpi">
        ${A.kpi('fa-file-invoice-dollar', 'pos', 'Total à facturer TTC', fc(r.ttc), 'HT ' + fc(r.ht) + ' · TVA 18 % ' + fc(r.tva))}
        ${A.kpi('fa-house-signal', 'info', 'Facture B2C (HT)', fc(r.htB2C), mn(r.ventesB2C) + ' ventes facturées')}
        ${A.kpi('fa-building', 'info', 'Facture B2B (HT)', fc(r.htB2B), mn(r.ventesB2B) + ' ventes facturées')}
        ${A.kpi('fa-hourglass-half', r.reportes ? 'warn' : '', 'Reportées', mn(r.reportes), 'non facturées ce mois (statut VALIDE)')}
        ${A.kpi('fa-sack-dollar', 'pos', 'Net ' + esc(pr), fc(r.netRgz), pcx(r.ht ? r.netRgz / r.ht : null) + ' de la facture HT')}
        ${A.kpi('fa-user-tie', '', 'Reversé aux vendeurs', fc(r.vendeurs), 'commissions + primes vendeurs')}</div>
      <div class="grid-2">
        ${A.carte('fd-donut', 'Rémunération ' + esc(pr) + ' — répartition', 'Ce que ' + esc(pr) + ' garde : part des commissions, primes partenaire, prime d\'objectif', '<div class="chart-box"><canvas id="fd-ch-donut" role="img" aria-label="Répartition de la rémunération"></canvas></div>')}
        ${A.carte('fd-struct', 'Structure de la facture B2C vs B2B', 'Montants HT : one-shot, primes des vendeurs, primes du partenaire', '<div class="chart-box"><canvas id="fd-ch-struct" role="img" aria-label="Structure de la facture"></canvas></div>')}</div>
      <div class="grid-2">
        ${A.carte('fd-b2c', 'Détail B2C', esc(moisFact()), '<div id="fd-t-b2c"></div>')}
        ${A.carte('fd-b2b', 'Détail B2B', esc(moisFact()), '<div id="fd-t-b2b"></div>')}</div>
      ${A.carte('fd-net', 'Rémunération nette ' + esc(pr), 'Facture HT = reversé aux vendeurs + net ' + esc(pr), '<div id="fd-t-net"></div>')}</div>`;
    const t = (id, l) => $(id).append(creer({ pageSize: 0, caption: id, lignes: l.filter((x) => x.m || x.toujours), colonnes: [{ cle: 'r', titre: 'Rubrique' }, { cle: 'm', titre: 'Montant HT (FCFA)', num: true, fmt: CT.fmt.mnt }], pied: { r: 'TOTAL HT', m: CT.somme(l, (x) => x.m) } }));
    t('#fd-t-b2c', [{ r: 'One-shot (' + mn(r.ventesB2C) + ' ventes)', m: r.oneShotB2C, toujours: 1 }, { r: 'Primes de performance vendeurs', m: r.primesVendB2C }, { r: 'Prime de performance partenaire', m: r.primePartB2C }, { r: 'Prime d\'atteinte de l\'objectif', m: r.primeObjectif }]);
    t('#fd-t-b2b', [{ r: 'One-shot (' + mn(r.ventesB2B) + ' ventes)', m: r.oneShotB2B, toujours: 1 }, { r: 'Primes vendeurs (hors reports)', m: r.primesVendB2B }, { r: 'Prime partenaire', m: r.primePartB2B }]);
    $('#fd-t-net').append(creer({ pageSize: 0, caption: 'Rémunération nette', lignes: [
      { r: 'Part ' + pr + ' des commissions B2C (20 %, Anonymat 0 %)', g: r.partRgzB2C }, { r: 'Part ' + pr + ' des commissions B2B (20 %)', g: r.partRgzB2B }, { r: 'Prime de performance partenaire B2C', g: r.primePartB2C },
      { r: 'Prime partenaire B2B', g: r.primePartB2B }, { r: 'Prime d\'atteinte de l\'objectif', g: r.primeObjectif }, { r: 'Reversé aux vendeurs B2C (commissions + primes)', v: r.vendeursB2C }, { r: 'Reversé aux vendeurs B2B (commissions + primes)', v: r.vendeursB2B }],
      colonnes: [{ cle: 'r', titre: 'Rubrique' }, { cle: 'g', titre: 'Net ' + pr + ' (FCFA)', num: true, fmt: (v) => (v == null ? '' : CT.fmt.mnt(v)) }, { cle: 'v', titre: 'Vendeurs (FCFA)', num: true, fmt: (v) => (v == null ? '' : CT.fmt.mnt(v)) }],
      pied: { r: 'TOTAL (= facture HT ' + CT.fmt.mnt(r.ht) + ')', g: r.netRgz, v: r.vendeurs } }));
    const P = A.palette(), parts = [['Part commissions B2C', r.partRgzB2C], ['Part commissions B2B', r.partRgzB2B], ['Prime partenaire B2C', r.primePartB2C], ['Prime partenaire B2B', r.primePartB2B], ['Prime d\'objectif', r.primeObjectif]].filter((x) => x[1] > 0);
    A.graphe('fd-ch-donut', { type: 'doughnut', data: { labels: parts.map((x) => x[0]), datasets: [{ data: parts.map((x) => x[1]), backgroundColor: P, borderWidth: 2, borderColor: A.jeton('--surface') }] },
      options: { cutout: '62%', interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (x) => ' ' + x.label + ' : ' + CT.fmt.fcfa(x.parsed) } } } } });
    const ds = (label, a, b, col) => ({ label, data: [a, b], backgroundColor: col, stack: 's', borderRadius: 4, maxBarThickness: 60 });
    A.graphe('fd-ch-struct', { type: 'bar', data: { labels: ['B2C', 'B2B'], datasets: [ds('One-shot', r.oneShotB2C, r.oneShotB2B, P[0]), ds('Primes vendeurs', r.primesVendB2C, r.primesVendB2B, P[2]), ds('Primes partenaire', r.primePartB2C + r.primeObjectif, r.primePartB2B, P[1])] },
      options: { plugins: { tooltip: { callbacks: { label: (x) => ' ' + x.dataset.label + ' : ' + CT.fmt.fcfa(x.parsed.y) } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => CT.fmt.int(v) } } } } });
  }

  async function vueEvo() {
    const root = $('#factevo-content'); if (!CT.etat.lignes.length) { root.innerHTML = vide2('Importez le fichier principal depuis le Tableau de bord.'); return; }
    root.innerHTML = '<div class="card empty" aria-busy="true"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><h3>Calcul en cours…</h3></div>';
    let d; try { d = await CT.analyse.donnees(); } catch (er) { root.innerHTML = vide2('Lecture impossible : ' + esc(er.message)); return; }
    const A = CT.analyse, AC = CT.analyseCalc, pr = CT.etat.prioritaire;
    const lignes = d.mois.map((c) => {
      const fin = AC.finMois(c) < d.au ? AC.finMois(c) : d.au, L = lignesFacturation(d.toutes, d.entete, c, fin, pr);
      const o = regles(c), r = synthese(L.b2c.length ? F.calculB2C(L.b2c, o) : null, L.b2b.length ? F.calculB2B(L.b2b, o) : null)   /* objectif du mois c */, obj = A.paramsMois(c).t.mois;
      return Object.assign(r, { cle: c, lib: AC.libMois(c), enCours: fin !== AC.finMois(c), objectif: obj, tro: obj ? r.ventes / obj : null, mixB2B: r.ventes ? r.ventesB2B / r.ventes : null });
    });
    S.evo = lignes;
    lignes.forEach((x, i) => { const p = lignes[i - 1]; x.evolHT = p && p.ht ? (x.ht - p.ht) / p.ht : null; x.evolV = p && p.ventes ? (x.ventes - p.ventes) / p.ventes : null; });
    const der = lignes[lignes.length - 1], ev = (x) => (x == null ? 'premier mois en base' : (x >= 0 ? '+' : '') + pcx(x, 0) + ' vs mois précédent');
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair('Facture de chaque mois des 3 derniers mois en base (jusqu\'au ' + CT.date.court(d.au) + ', date de fin en haut de l\'écran), même règle que les factures. Objectif = Paramètres › Objectifs du mois.', 'fa-circle-info')}
      <div class="grid-kpi">
        ${A.kpi('fa-file-invoice-dollar', 'pos', 'Facture HT — ' + esc(der.lib), fc(der.ht), ev(der.evolHT))}
        ${A.kpi('fa-cart-shopping', 'info', 'Ventes facturées', mn(der.ventes), ev(der.evolV))}
        ${A.kpi('fa-sack-dollar', 'pos', 'Net ' + esc(pr), fc(der.netRgz), esc(der.lib))}
        ${A.kpi('fa-bullseye', der.tro != null && der.tro >= 1 ? 'pos' : 'warn', 'Ventes vs objectif', pcx(der.tro, 0), mn(der.ventes) + ' / ' + mn(der.objectif) + (der.enCours ? ' (mois en cours)' : ''))}</div>
      <div class="grid-2">
        ${A.carte('fe-rev', 'Revenus — évolution', 'Facture HT et net ' + esc(pr) + ' par mois (FCFA)', '<div class="chart-box"><canvas id="fe-ch-rev" role="img" aria-label="Revenus par mois"></canvas></div>')}
        ${A.carte('fe-v', 'Ventes facturées vs objectif', 'Objectif du mois de Paramètres', '<div class="chart-box"><canvas id="fe-ch-v" role="img" aria-label="Ventes vs objectif"></canvas></div>')}</div>
      ${A.carte('fe-tab', 'Tableau comparatif', 'Mois par mois', '<div id="fe-t"></div>')}</div>`;
    $('#fe-t').append(creer({ pageSize: 0, caption: 'Évolution de la facturation', lignes, colonnes: [{ cle: 'lib', titre: 'Mois', fmt: (v, x) => v + (x.enCours ? ' (en cours)' : '') }, { cle: 'ventesB2C', titre: 'Ventes B2C', num: true, fmt: mn }, { cle: 'ventesB2B', titre: 'Ventes B2B', num: true, fmt: mn },
      { cle: 'reportes', titre: 'Reportées', num: true, fmt: mn }, { cle: 'mixB2B', titre: 'Mix B2B', num: true, fmt: (v) => pcx(v) }, { cle: 'tro', titre: '% objectif', num: true, fmt: (v) => pcx(v, 0) }, { cle: 'ht', titre: 'Facture HT (FCFA)', num: true, fmt: CT.fmt.mnt },
      { cle: 'ttc', titre: 'TTC (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'vendeurs', titre: 'Vendeurs (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'netRgz', titre: 'Net ' + pr + ' (FCFA)', num: true, fmt: CT.fmt.mnt }],
      pied: { lib: 'TOTAL', ventesB2C: CT.somme(lignes, (x) => x.ventesB2C), ventesB2B: CT.somme(lignes, (x) => x.ventesB2B), reportes: CT.somme(lignes, (x) => x.reportes), ht: CT.somme(lignes, (x) => x.ht), ttc: CT.somme(lignes, (x) => x.ttc), vendeurs: CT.somme(lignes, (x) => x.vendeurs), netRgz: CT.somme(lignes, (x) => x.netRgz) } }));
    const P = A.palette(), lab = lignes.map((x) => x.lib), bar = { borderRadius: 4, maxBarThickness: 40 };
    A.graphe('fe-ch-rev', { type: 'bar', data: { labels: lab, datasets: [Object.assign({ label: 'Facture HT', data: lignes.map((x) => x.ht), backgroundColor: P[0] }, bar), Object.assign({ label: 'Net ' + pr, data: lignes.map((x) => x.netRgz), backgroundColor: P[1] }, bar)] },
      options: { plugins: { tooltip: { callbacks: { label: (x) => ' ' + x.dataset.label + ' : ' + CT.fmt.fcfa(x.parsed.y) } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => CT.fmt.int(v) } } } } });
    A.graphe('fe-ch-v', { type: 'bar', data: { labels: lab, datasets: [Object.assign({ label: 'B2C', data: lignes.map((x) => x.ventesB2C), backgroundColor: P[0], stack: 'v' }, bar), Object.assign({ label: 'B2B', data: lignes.map((x) => x.ventesB2B), backgroundColor: P[2], stack: 'v' }, bar),
      { type: 'line', label: 'Objectif', data: lignes.map((x) => x.objectif), borderColor: A.jeton('--text-3'), borderDash: [6, 4], pointRadius: 3, fill: false }] }, options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } } } });
  }

  /* Paliers de prime : libellé, prime, ventes manquantes pour le palier suivant */
  function palier(paliers, n) {
    let i = 0; paliers.forEach((p, k) => { if (n >= p[0]) i = k; });
    const sv = paliers[i + 1];
    return { prime: paliers[i][1], seuil: paliers[i][0], lib: i === 0 ? 'Sans prime (< ' + paliers[1][0] + ')' : paliers[i][0] + (sv ? '–' + (sv[0] - 1) : '+') + ' ventes', manque: sv ? sv[0] - n : 0, primeSuivante: sv ? sv[1] : null };
  }
  function agentsFactures() {
    const R = F.REGLES, m = new Map(), get = (g) => { let a = m.get(g.loginKey); if (!a) m.set(g.loginKey, (a = { loginKey: g.loginKey, login: g.login, equipe: g.equipe || '', anonymat: g.anonymat, b2c: 0, b2b: 0, b2bHorsReports: 0, primeB2C: 0, primeB2B: 0, commission: 0 })); return a; };
    (S.c2c ? S.c2c.logins : []).forEach((g) => { const a = get(g); a.b2c = g.ventes; a.primeB2C = g.primePerf; a.commission += g.partVendeur; });
    (S.c2b ? S.c2b.logins : []).forEach((g) => { const a = get(g); a.b2b = g.ventes; a.b2bHorsReports = g.ventes - g.reports; a.primeB2B = g.primeVTB; a.commission += g.commVTB; });
    return [...m.values()].map((a) => Object.assign(a, { ventes: a.b2c + a.b2b, gain: a.commission + a.primeB2C + a.primeB2B, pC: palier(R.b2c.primeVendeur, a.b2c), pB: palier(R.b2b.primeVendeur, a.b2bHorsReports) })).sort((x, y) => y.gain - x.gain || y.ventes - x.ventes);
  }
  function vuePerf() {
    const root = $('#factperf-content'), ag = agentsFactures(), A = CT.analyse;
    if (!ag.length) { root.innerHTML = vide2('Aucune vente facturée sur ce mois.'); return; }
    const primes = ag.filter((a) => a.primeB2C + a.primeB2B > 0), R = F.REGLES;
    const distrib = R.b2c.primeVendeur.map((p, i) => ({ lib: palier(R.b2c.primeVendeur, p[0]).lib, prime: p[1], n: ag.filter((a) => palier(R.b2c.primeVendeur, a.b2c).seuil === p[0]).length }));
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair('Agents payés sur les factures ' + esc(deMois(moisFact())) + ' : ventes facturées, commission (80 %, Anonymat 100 %), prime de performance et ventes qui manquent pour le palier suivant.', 'fa-circle-info')}
      <div class="grid-kpi">
        ${A.kpi('fa-users', 'info', 'Agents payés', mn(ag.length), mn(primes.length) + ' avec une prime de performance')}
        ${A.kpi('fa-trophy', 'pos', 'N°1 du mois', esc(nomLogin(ag[0].loginKey)), mn(ag[0].ventes) + ' ventes · ' + fc(ag[0].gain))}
        ${A.kpi('fa-medal', 'warn', 'Primes de performance', fc(CT.somme(ag, (a) => a.primeB2C + a.primeB2B)), 'moyenne ' + fc(primes.length ? CT.somme(primes, (a) => a.primeB2C + a.primeB2B) / primes.length : 0) + ' par agent primé')}
        ${A.kpi('fa-arrow-up-right-dots', '', 'Proches du palier suivant', mn(ag.filter((a) => a.pC.manque > 0 && a.pC.manque <= 3).length), '3 ventes B2C ou moins à faire')}</div>
      <div class="grid-2">
        ${A.carte('fp-top', 'Top 10 agents — gains du mois', 'Commission + primes (FCFA)', '<div class="chart-box tall"><canvas id="fp-ch-top" role="img" aria-label="Top agents"></canvas></div>')}
        ${A.carte('fp-pal', 'Distribution par palier de prime B2C', 'Nombre d\'agents par palier (grille ' + R.b2c.primeVendeur.slice(1).map((p) => p[0] + '+ = ' + CT.fmt.int(p[1])).join(' · ') + ')', '<div class="chart-box tall"><canvas id="fp-ch-pal" role="img" aria-label="Distribution par palier"></canvas></div>')}</div>
      ${A.carte('fp-tab', 'Classement complet', 'Trié par gain du mois', '<div id="fp-t"></div>')}</div>`;
    $('#fp-t').append(creer({ pageSize: 20, recherche: true, caption: 'Performance agents', lignes: ag.map((a, i) => Object.assign({ rang: i + 1 }, a)), colonnes: [{ cle: 'rang', titre: 'N°', num: true }, { cle: 'login', titre: 'Agent', fmt: (v, a) => nomLogin(a.loginKey) + (a.anonymat ? ' (Anonymat)' : '') }, { cle: 'equipe', titre: 'Équipe' },
      { cle: 'b2c', titre: 'B2C', num: true, fmt: mn }, { cle: 'b2b', titre: 'B2B', num: true, fmt: mn }, { cle: 'pC', titre: 'Palier B2C', tri: (a) => a.b2c, fmt: (v) => v.lib }, { cle: 'manque', titre: 'Palier suivant', tri: (a) => a.pC.manque || 999, fmt: (v, a) => (a.pC.manque ? 'encore ' + a.pC.manque + ' vente(s) → ' + CT.fmt.int(a.pC.primeSuivante) : 'palier maximal') },
      { cle: 'commission', titre: 'Commission (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'primeB2C', titre: 'Prime B2C', num: true, fmt: CT.fmt.mnt }, { cle: 'primeB2B', titre: 'Prime B2B', num: true, fmt: CT.fmt.mnt }, { cle: 'gain', titre: 'Total (FCFA)', num: true, html: true, fmt: (v) => '<b>' + CT.fmt.mnt(v) + '</b>' }],
      pied: { login: 'TOTAL', b2c: CT.somme(ag, (a) => a.b2c), b2b: CT.somme(ag, (a) => a.b2b), commission: CT.somme(ag, (a) => a.commission), primeB2C: CT.somme(ag, (a) => a.primeB2C), primeB2B: CT.somme(ag, (a) => a.primeB2B), gain: CT.somme(ag, (a) => a.gain) } }));
    const P = A.palette(), top = ag.slice(0, 10);
    A.graphe('fp-ch-top', { type: 'bar', data: { labels: top.map((a) => nomLogin(a.loginKey)), datasets: [{ label: 'Commission', data: top.map((a) => a.commission), backgroundColor: P[0], stack: 'g', borderRadius: 4 }, { label: 'Primes', data: top.map((a) => a.primeB2C + a.primeB2B), backgroundColor: P[2], stack: 'g', borderRadius: 4 }] },
      options: { indexAxis: 'y', plugins: { tooltip: { callbacks: { label: (x) => ' ' + x.dataset.label + ' : ' + CT.fmt.fcfa(x.parsed.x) } } }, scales: { x: { stacked: true, beginAtZero: true, ticks: { callback: (v) => CT.fmt.int(v) } }, y: { stacked: true, grid: { display: false } } } } });
    A.graphe('fp-ch-pal', { type: 'bar', data: { labels: distrib.map((x) => x.lib), datasets: [{ label: 'Agents', data: distrib.map((x) => x.n), backgroundColor: distrib.map((x, i) => P[i % P.length]), borderRadius: 4, maxBarThickness: 48 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  }

  function vueReco() {
    const root = $('#factreco-content'), c = S.c2c, d = S.c2b, A = CT.analyse, R = F.REGLES, pr = CT.etat.prioritaire;
    if (!c && !d) { root.innerHTML = vide2('Aucune vente facturée sur ce mois.'); return; }
    const reco = [], ag = agentsFactures();
    // 1. Agents à 3 ventes ou moins du palier B2C suivant (et 2 ventes en B2B)
    const procheC = ag.filter((a) => a.pC.manque > 0 && a.pC.manque <= 3), procheB = ag.filter((a) => a.b2bHorsReports > 0 && a.pB.manque > 0 && a.pB.manque <= 2);
    if (procheC.length) reco.push({ ic: 'fa-arrow-up-right-dots', titre: procheC.length + ' agent(s) à 3 ventes B2C ou moins du palier de prime suivant', gain: CT.somme(procheC, (a) => a.pC.primeSuivante - a.pC.prime),
      detail: procheC.slice(0, 10).map((a) => nomLogin(a.loginKey) + ' : ' + a.b2c + ' → ' + (a.b2c + a.pC.manque) + ' (+' + CT.fmt.int(a.pC.primeSuivante - a.pC.prime) + ')').join(' · ') + '. Un accompagnement ciblé d\'ici la fin du mois augmente la facture (prime facturée à Celtiis).' });
    if (procheB.length) reco.push({ ic: 'fa-building', titre: procheB.length + ' agent(s) à 2 ventes B2B ou moins du palier suivant', gain: CT.somme(procheB, (a) => a.pB.primeSuivante - a.pB.prime),
      detail: procheB.slice(0, 10).map((a) => nomLogin(a.loginKey) + ' : ' + a.b2bHorsReports + ' → ' + (a.b2bHorsReports + a.pB.manque)).join(' · ') + '.' });
    // 2. Prime partenaire : palier suivant (prix par vente appliqué à TOUTES les ventes)
    const pp = (paliers, n, prixActuel, seg) => { const sv = paliers.find((p) => p[0] > n); if (!sv) return; const manque = sv[0] - n, gain = sv[0] * sv[1] - n * prixActuel;
      reco.push({ ic: 'fa-handshake', titre: 'Prime partenaire ' + seg + ' : ' + manque + ' vente(s) pour passer à ' + CT.fmt.int(sv[1]) + ' FCFA par vente', gain, detail: mn(n) + ' ventes facturées aujourd\'hui (' + CT.fmt.int(prixActuel) + ' FCFA par vente). Au seuil de ' + mn(sv[0]) + ' ventes, le nouveau prix s\'applique à toutes les ventes du mois.' }); };
    if (c) pp(R.b2c.primePartenaire, c.quantite, c.prixPrimePartenaire, 'B2C');
    if (d) pp(R.b2b.primePartenaire, d.payees, d.prixPrimePVT, 'B2B');
    // 3. Reports à récupérer : ventes en attente (VALIDE) facturables une fois validées
    const repC = c ? c.nonPayes.reportes : 0, repB = d ? d.nonPayes.reportes : 0, osC = c && c.quantite ? c.oneShot / c.quantite : 0, osB = d && d.payees ? (d.commVTB + d.commPVT) / d.payees : 0;
    if (repC + repB) reco.push({ ic: 'fa-hourglass-half', titre: mn(repC + repB) + ' vente(s) reportée(s) à faire valider', gain: repC * osC + repB * osB, detail: mn(repC) + ' B2C et ' + mn(repB) + ' B2B au statut VALIDE : relancer installation et validation pour les facturer (one-shot moyen ' + CT.fmt.int(osC) + ' FCFA en B2C' + (repB ? ', ' + CT.fmt.int(osB) + ' FCFA en B2B' : '') + ').' });
    // 4. Prime d'atteinte de l'objectif (B2C)
    if (c && c.objectif) { const sv = R.b2c.primeObjectif.find((p) => p[0] > c.quantite); if (!c.objectifAtteint) reco.push({ ic: 'fa-bullseye', titre: 'Prime d\'objectif : ' + mn(c.objectif - c.quantite) + ' vente(s) B2C manquante(s)', gain: [[0, 0]].concat(R.b2c.primeObjectif).filter((p) => c.objectif >= p[0]).pop()[1], detail: 'Objectif B2C du mois : ' + mn(c.objectif) + ' ventes (Paramètres › Objectifs).' }); else if (sv) reco.push({ ic: 'fa-bullseye', titre: 'Prime d\'objectif : ' + mn(sv[0] - c.quantite) + ' vente(s) pour le palier de ' + CT.fmt.int(sv[1]), gain: sv[1] - c.primeObjectif, detail: 'Objectif atteint ; le palier suivant de la prime d\'objectif est à ' + mn(sv[0]) + ' ventes.' }); }
    else if (c) reco.push({ ic: 'fa-bullseye', titre: 'Prime d\'atteinte de l\'objectif non calculée', gain: 0, detail: 'Aucun objectif B2C pour ce mois dans Paramètres › Objectifs : créez les objectifs du mois pour que la prime soit calculée.' });
    // 5. Mix B2B : une vente B2B rapporte plus qu'une vente B2C
    if (c && d && osB > osC) reco.push({ ic: 'fa-scale-balanced', titre: 'Une vente B2B rapporte ' + CT.fmt.int(osB - osC) + ' FCFA de plus qu\'une vente B2C', gain: 0, detail: 'One-shot moyen : ' + CT.fmt.int(osB) + ' FCFA en B2B contre ' + CT.fmt.int(osC) + ' FCFA en B2C. Orienter les vendeurs vers les entreprises augmente la facture à volume égal.' });
    reco.sort((x, y) => y.gain - x.gain); S.reco = reco;
    const tot = CT.somme(reco, (x) => x.gain);
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair('Leviers d\'amélioration des gains ' + esc(pr) + ' sur les factures ' + esc(deMois(moisFact())) + ', triés par gain potentiel (montants HT facturables à Celtiis).', 'fa-lightbulb')}
      <div class="grid-kpi">${A.kpi('fa-sack-dollar', 'pos', 'Gain potentiel identifié', fc(tot), reco.filter((x) => x.gain > 0).length + ' levier(s) chiffré(s)')}</div>
      ${A.carte('fr-liste', 'Leviers d\'amélioration', 'Du plus rentable au moins rentable', `<ul class="alerts">${reco.map((x) => `<li class="alert ${x.gain > 0 ? 'pos' : 'info'}"><span class="alert-ic"><i class="fa-solid ${x.ic}" aria-hidden="true"></i></span><div><strong>${esc(x.titre)}${x.gain > 0 ? ' — +' + esc(fc(x.gain)) : ''}</strong><span>${esc(x.detail)}</span></div></li>`).join('') || '<li class="muted">Aucun levier identifié.</li>'}</ul>`)}</div>`;
  }

  const RENDU = { challogin: () => vueChallenge('login'), chalequipe: () => vueChallenge('equipe'), factb2c: vueB2C, factb2b: vueB2B, finance: vueFinance, reports: vueReports, factdash: vueDash, factevo: vueEvo, factperf: vuePerf, factreco: vueReco };
  async function rendre() {
    const v = CT.etat.vue; masquerBarres(); if (!RENDU[v]) return;
    if (v !== 'challogin' && v !== 'chalequipe') { try { await depuisBase(); } catch (er) { console.warn('Facturation : lecture en base impossible', er); } if (CT.etat.vue !== v) return; }
    RENDU[v]();
  }
  function masquerBarres() {
    const v = CT.etat.vue, nouvelle = !!VUES[v], challenge = v.indexOf('chal') === 0, avecDonnees = !!CT.etat.lignes.length;
    const sb = $('#sharebar'), gf = $('#global-date-filters'), st = $('#filter-status');
    if (sb) sb.hidden = !avecDonnees;                                // la barre d'export sert aussi sur ces pages (module ci-dessous)
    if (st) st.hidden = nouvelle && !challenge;
    if (gf) gf.hidden = !avecDonnees;    // challenge : période ; facturation : la date de fin choisit le mois facturé
  }
  function evenements(e) {
    const t = e.target;
    if (t.matches && t.matches('input[type=file][data-seg]') && t.files[0]) importer(t.dataset.seg, t.files[0]);
    if (t.id === 'rp-pas') { S.pas = t.value; rendre(); }
  }
  function clics(e) {
    const b = e.target.closest && e.target.closest('button[id^="xl-"]'); if (!b) return;
    const mois = (CT.etat.cle || new Date().toISOString().slice(0, 7));
    try {
      if (b.id === 'xl-b2c') telecharger('Facturation_B2C_' + mois, feuillesB2C());
      else if (b.id === 'xl-b2b' || b.id === 'xl-fb2b') telecharger('Facturation_B2B_' + mois, feuillesB2B());
      else if (b.id === 'xl-fin') telecharger('Point_financier_par_login_' + mois, feuillesFinance());
      else if (b.id === 'xl-rp') telecharger('Reports_' + S.pas, feuillesReports());
      else if (b.id === 'xl-ch' && S.chDef) telecharger(S.chDef.nom.replace(/\s/g, '_'), [S.chDef]);
    } catch (err) { CT.toast('Export impossible : ' + err.message, 'err'); }
  }
  document.addEventListener('change', evenements);
  document.addEventListener('click', clics);

  /* ---------- Barre d'export (Excel, PDF, CSV, WhatsApp, Gmail, Outlook, Copier) : données de chaque page Facturation ---------- */
  function feuillesReports() {
    return [{ nom: 'Reports ' + S.pas, cols: [36, 12, 18, 18], aoa: [[S.pas === 'mois' ? 'Mois' : 'Semaine (du lundi au dimanche)', 'Reportés', 'Payés après report', 'Cumul en attente']]
      .concat(F.reports((S.b2c ? S.b2c.lignes : []).concat(S.b2b ? S.b2b.lignes : []), S.pas).map((r) => [libPeriode(r.periode), r.reportes, r.payes, r.cumulReste])) }];
  }
  function feuillesDash() {
    const r = synthese(S.c2c, S.c2b), pr = CT.etat.prioritaire;
    return [{ nom: 'Tableau de bord factures', cols: [44, 22], total: false, aoa: [['Indicateur', 'Valeur'], ['Période', moisFact()], ['Total à facturer TTC (FCFA)', r.ttc], ['Total HT (FCFA)', r.ht], ['TVA 18 % (FCFA)', r.tva],
        ['Facture B2C HT (FCFA)', r.htB2C], ['Ventes B2C facturées', r.ventesB2C], ['Facture B2B HT (FCFA)', r.htB2B], ['Ventes B2B facturées', r.ventesB2B], ['Ventes reportées (non facturées)', r.reportes],
        ['Net ' + pr + ' (FCFA)', r.netRgz], ['Reversé aux vendeurs (FCFA)', r.vendeurs]] },
      { nom: 'Rémunération nette', cols: [50, 18, 18], total: false, aoa: [['Rubrique', 'Net ' + pr + ' (FCFA)', 'Vendeurs (FCFA)'], ['Part ' + pr + ' des commissions B2C', r.partRgzB2C, ''], ['Part ' + pr + ' des commissions B2B', r.partRgzB2B, ''],
        ['Prime de performance partenaire B2C', r.primePartB2C, ''], ['Prime partenaire B2B', r.primePartB2B, ''], ['Prime d\'atteinte de l\'objectif', r.primeObjectif, ''], ['Reversé aux vendeurs B2C', '', r.vendeursB2C], ['Reversé aux vendeurs B2B', '', r.vendeursB2B],
        ['TOTAL (= facture HT ' + CT.fmt.int(r.ht) + ')', r.netRgz, r.vendeurs]] }]
      .concat(S.c2c ? feuillesB2C().slice(0, 1) : [], S.c2b ? feuillesB2B().slice(0, 1) : []);
  }
  function feuillesEvo() {
    const L = S.evo || [], s = (k) => CT.somme(L, (x) => x[k] || 0);
    return [{ nom: 'Évolution facturation', cols: [18, 12, 12, 12, 14, 18, 18, 18, 18, 18], total: false, aoa: [['Mois', 'Ventes B2C', 'Ventes B2B', 'Reportées', 'Mix B2B (taux)', 'Taux d\'atteinte objectif', 'Facture HT (FCFA)', 'TTC (FCFA)', 'Vendeurs (FCFA)', 'Net ' + CT.etat.prioritaire + ' (FCFA)']]
      .concat(L.map((x) => [x.lib + (x.enCours ? ' (en cours)' : ''), x.ventesB2C, x.ventesB2B, x.reportes, x.mixB2B == null ? '' : x.mixB2B, x.tro == null ? '' : x.tro, x.ht, x.ttc, x.vendeurs, x.netRgz]),
        [['TOTAL', s('ventesB2C'), s('ventesB2B'), s('reportes'), '', '', s('ht'), s('ttc'), s('vendeurs'), s('netRgz')]]) }];
  }
  function feuillesPerf() {
    const ag = agentsFactures(), R = F.REGLES, s = (k) => CT.somme(ag, (a) => a[k] || 0);
    return [{ nom: 'Performance agents', cols: [6, 26, 16, 8, 8, 18, 30, 16, 14, 14, 16], total: false, aoa: [['N°', 'Agent', 'Équipe', 'B2C', 'B2B', 'Palier B2C', 'Palier suivant', 'Commission (FCFA)', 'Prime B2C (FCFA)', 'Prime B2B (FCFA)', 'Total (FCFA)']]
        .concat(ag.map((a, i) => [i + 1, a.login + (a.anonymat ? ' (Anonymat)' : ''), a.equipe, a.b2c, a.b2b, a.pC.lib, a.pC.manque ? 'encore ' + a.pC.manque + ' vente(s) → ' + CT.fmt.int(a.pC.primeSuivante) : 'palier maximal', a.commission, a.primeB2C, a.primeB2B, a.gain]),
          [['TOTAL', '', '', s('b2c'), s('b2b'), '', '', s('commission'), s('primeB2C'), s('primeB2B'), s('gain')]]) },
      { nom: 'Paliers de prime B2C', cols: [26, 18, 10], total: false, aoa: [['Palier', 'Prime (FCFA)', 'Agents']].concat(R.b2c.primeVendeur.map((p) => [palier(R.b2c.primeVendeur, p[0]).lib, p[1], ag.filter((a) => palier(R.b2c.primeVendeur, a.b2c).seuil === p[0]).length]), [['TOTAL', '', ag.length]]) }];
  }
  function feuillesReco() {
    const L = S.reco || [];
    return [{ nom: 'Recommandations', cols: [70, 22, 110], total: false, aoa: [['Levier', 'Gain potentiel HT (FCFA)', 'Détail']].concat(L.map((x) => [x.titre, x.gain || 0, x.detail]), [['TOTAL', CT.somme(L, (x) => x.gain || 0), '']]) }];
  }
  const MODULES = { factdash: ['Tableau de bord des factures', feuillesDash], factb2b: ['Facture B2B', feuillesB2B], factb2c: ['Facture B2C', feuillesB2C], factevo: ['Évolution de la facturation', feuillesEvo],
    factperf: ['Performance agents', feuillesPerf], factreco: ['Recommandations', feuillesReco], finance: ['Point financier par login', feuillesFinance], reports: ['Reports', feuillesReports],
    challogin: ['Challenge login', () => (S.chDef ? [S.chDef] : [])], chalequipe: ['Challenge équipe', () => (S.chDef ? [S.chDef] : [])] };
  /** Module d'export de la page affichée : { titre, nom, feuilles(), resume() } — utilisé par la barre (partage.js) */
  function module(vue) {
    const m = MODULES[vue]; if (!m) return null;
    const feuilles = () => { let f = []; try { f = m[1]() || []; } catch (er) { f = []; } return f.length ? f : [{ nom: m[0], total: false, aoa: [['Information'], ['Aucune donnée pour ' + moisFact()]] }]; };
    const resume = () => { const f = feuilles()[0], lignes = f.aoa.slice(1, 13).filter((r) => r && r.length && r[0] !== '' && r[0] != null);
      return m[0] + ' — ' + moisFact() + '\n' + lignes.map((r) => '• ' + r.filter((v) => v !== '' && v != null).map((v) => (typeof v === 'number' ? CT.fmt.int(v) : String(v))).join(' : ')).join('\n'); };
    return { titre: m[0], nom: m[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '_'), feuilles, resume };
  }

  /* Chargement direct de lignes déjà lues (utilisé par les tests de l'interface) */
  function charger(seg, lignes, fichier) { S.test = true; S[seg] = { fichier: fichier || 'test', onglet: 'test', lignes, ignorees: { sansDebit: 0 } }; recalculer(); rendre(); }
  CT.factUI = { VUES, charger, module, feuillesGlobales: () => (S.c2c || S.c2b ? feuillesDash() : []), surVue: rendre, rafraichir: () => { if (VUES[CT.etat.vue]) rendre(); else masquerBarres(); }, etat: S };
})();
