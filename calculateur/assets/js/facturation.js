/* ============================================================================
   facturation.js — pages « Challenge » et « Facturation Celtiis » du tableau de bord interne :
   Challenge login / équipe · Facturation B2C · Facturation B2B · Point financier par login · Reports.
   Les calculs sont dans facturation_calc.js (testés : node tests/facturation.test.js).
   Source de la facture : fichiers « POINT VENTES » de fin de mois importés dans Facturation › Résumé (table factures_lignes) ;
   seules les lignes « A PAYER » et les arriérés sont facturés. Les Challenges utilisent les souscriptions du Tableau de bord.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT, F = CT.fact, $ = (s, r) => (r || document).querySelector(s);
  const creer = (o) => CT.table.creer(o).el;   // CT.table.creer renvoie {el, maj}
  const mn = (n) => CT.fmt.int(n), fc = (n) => CT.fmt.fcfa(n), esc = CT.esc;

  const VUES = { challogin: 'Challenge login', chalequipe: 'Challenge équipe', factb2c: 'Facturation B2C', factb2b: 'Facturation B2B', finance: 'Point financier par login', reports: 'Reports', factdash: 'Résumé de la facturation', factevo: 'Évolution de la facturation', factperf: 'Performance agents', factreco: 'Recommandations' };
  const S = CT.factEtat = { b2c: null, b2b: null, pas: 'semaine', params: {}, c2c: null, c2b: null, pf: null, mois: null, moisDispo: null, cache: new Map(), choix: null, historique: null };

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
  /* Objectif FTTH B2C donné chaque mois par l'OPÉRATEUR (saisi dans Facture B2C, gardé en base : table factures_objectifs).
     Il déclenche la « PRIME PARTENAIRE INDEXÉE AU TAUX D'ATTEINTE OBJECTIF FTTH ». Pas d'objectif saisi pour le mois : facture sans cette prime. */
  function regles(cle) {
    const m = cle || S.mois, obj = m && S.objOp ? S.objOp[m] : null;
    return { regles: { b2c: { objectif: obj != null && obj > 0 ? obj : null } } };
  }
  async function objectifsOperateur(forcer) {
    if (!S.objOp || forcer) { try { S.objOp = ((await CT.api.factures.objectifs()) || {}).objectifs || {}; } catch (e) { S.objOp = S.objOp || {}; } }
    return S.objOp;
  }
  async function enregistrerObjectif(mois, valeur) {
    const v = String(valeur == null ? '' : valeur).replace(/\s/g, '');
    if (v !== '' && !/^\d+$/.test(v)) { CT.toast('Saisissez un nombre entier de ventes (ex. 1000), ou laissez vide pour retirer l\'objectif.', 'err', 7000); return; }
    try {
      await CT.api.factures.enregistrerObjectif(mois, v === '' ? null : +v);
      S.objOp = Object.assign({}, S.objOp, { [mois]: v === '' ? null : +v }); if (v === '') delete S.objOp[mois];
      CT.toast(v === '' ? 'Objectif de ' + CT.date.libelleMois(mois) + ' retiré : facture sans la prime indexée.' : 'Objectif de l\'opérateur pour ' + CT.date.libelleMois(mois) + ' : ' + CT.fmt.int(+v) + ' ventes. Facture recalculée.', 'ok', 6000);
      S.cleBase = null; rendre();
    } catch (e) { CT.toast('Enregistrement impossible : ' + e.message, 'err', 9000); }
  }
  /** Carte de saisie de l'objectif de l'opérateur (page Facture B2C) ; en cumul : objectifs de chaque mois, saisie sur un mois seul. */
  function carteObjectif() {
    const grille = F.REGLES.b2c.primeObjectif.map((p, i, a) => (a[i + 1] ? p[0] + ' à ' + (a[i + 1][0] - 1) : p[0] + ' et plus') + ' ventes : ' + CT.fmt.int(p[1]) + ' HT').join(' · ');
    if (S.multi) {
      return `<section class="card no-print"><div class="card-head"><div><h3>Objectif FTTH de l'opérateur</h3><p>Prime partenaire indexée au taux d'atteinte : ${esc(grille)}</p></div></div>
        <p class="muted">${S.parMois.map((x) => esc(CT.date.libelleMois(x.mois)) + ' : <b>' + (S.objOp[x.mois] ? mn(S.objOp[x.mois]) + ' ventes' : 'non saisi') + '</b>').join(' · ')}. Choisissez un mois seul en haut pour saisir ou modifier son objectif.</p></section>`;
    }
    const c = S.c2c, o = S.objOp[S.mois];
    const etat = !o ? 'Objectif non saisi : la facture est faite <b>sans</b> la prime indexée.'
      : c && c.objectifAtteint ? 'Objectif atteint : <b>' + mn(c.ventesObjectif) + '</b> ventes du mois pour un objectif de <b>' + mn(o) + '</b> → prime de <b>' + fc(c.primeObjectif) + '</b> HT.' + (c.primeObjectif ? '' : ' (moins de 300 ventes : pas de tranche)')
        : 'Objectif non atteint : <b>' + mn(c ? c.ventesObjectif : 0) + '</b> ventes du mois pour un objectif de <b>' + mn(o) + '</b> → pas de prime.';
    return `<section class="card no-print"><div class="card-head"><div><h3>Objectif FTTH de l'opérateur — ${esc(CT.date.libelleMois(S.mois))}</h3>
        <p>Donné chaque mois par l'opérateur. Ventes du mois (A PAYER, sans les arriérés) ≥ objectif → prime partenaire indexée : ${esc(grille)}. Gardé en base pour ce mois.</p></div></div>
      <form class="objectif-op" id="fo-obj" data-mois="${S.mois}"><label class="field" style="margin:0"><span class="kpi-label">Objectif B2C (ventes)</span>
        <input class="input input-sm" id="fo-val" type="number" min="0" step="1" inputmode="numeric" placeholder="ex. 1000" value="${o != null ? o : ''}"></label>
        <button class="btn btn-primary btn-sm" type="submit"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>Enregistrer</button>
        <p class="muted" style="margin:0">${etat}</p></form></section>`;
  }
  function recalculer() {
    if (S.multi) return;   // plusieurs mois : résultats déjà calculés mois par mois puis additionnés (depuisBase)
    const o = regles(S.mois);
    S.c2c = S.b2c ? F.calculB2C(S.b2c.lignes, o) : null;
    S.c2b = S.b2b ? F.calculB2B(S.b2b.lignes, o) : null;
    S.pf = S.c2c || S.c2b ? F.pointFinancier(S.c2c, S.c2b, o) : null;
  }

  /* ---------- Données : fichiers « POINT VENTES » importés (API /factures) ----------
     Chaque ligne du fichier a un état calculé à l'import (src/Services/FactureImporter.php) :
       PAYE = « A PAYER » (facturée) · REPORT_PAYE = arriéré à payer (facturé, compté à part) · REPORTE = « PAIEMENT REPORTE » · NON_VALIDE = le reste.
     Débit FTTH_Home_* → facture B2C ; autres débits (FTTH_PRO, FIBRE_…) → facture B2B. Mois affiché : celui choisi, sinon le dernier importé. */
  async function listeMois(forcer) {
    if (!S.moisDispo || forcer) S.moisDispo = ((await CT.api.factures.mois()) || {}).mois || [];
    return S.moisDispo;
  }
  async function lignesMois(M) {
    if (!S.cache.has(M)) S.cache.set(M, ((await CT.api.factures.lignes(M)) || {}).lignes || []);
    return S.cache.get(M);
  }
  function oublier() { S.moisDispo = null; S.historique = null; S.cache.clear(); S.cleBase = null; }
  /** Lignes du fichier → lignes du moteur de facture (facturation_calc.js). */
  function convertir(rows, M) {
    const pr = (CT.etat && CT.etat.prioritaire) || 'RGZ', b2c = [], b2b = [];
    const idx = CT.store && CT.store.actifs ? CT.objectifs.indexLogins(CT.store.actifs(M).objectifs) : new Map();
    rows.forEach((r) => {
      const login = r.login || '', loginKey = r.login_key || F.cleLogin(login), o = idx.get(loginKey), debit = String(r.debit || '').toUpperCase();
      const base = { login, loginKey, jour: r.date_commande ? String(r.date_commande).slice(0, 10) : null, equipe: o ? o.equipe : '', msisdn: r.numero || '', statut: r.statut || '', facture: r.facture || '', liste: r.liste };
      if (!debit || /^FTTH_HOME_/.test(debit)) b2c.push(Object.assign(base, { debit, paiement: r.etat }));
      else b2b.push(Object.assign(base, { debit, partenaire: pr, typeVente: r.etat === 'REPORT_PAYE' ? 'Report' : M, paiement: r.etat === 'REPORT_PAYE' ? 'PAYE' : r.etat }));
    });
    return { b2c, b2b };
  }
  /* Sélection de la barre « Mois facturé » : un mois (« m:AAAA-MM ») ou une plage (« p:AAAA-MM|AAAA-MM » : 3 derniers mois, depuis janvier, année).
     Sans choix (ouverture, actualisation) : le DERNIER mois importé. */
  function moisChoisis(dispo) {
    const v = S.choix || '', der = dispo[dispo.length - 1];
    if (v.startsWith('p:')) { const [du, au] = v.slice(2).split('|'), l = dispo.filter((m) => m >= du && m <= au); if (l.length) return l; }
    if (v.startsWith('m:') && dispo.includes(v.slice(2))) return [v.slice(2)];
    return [der];
  }
  /** Une facture par mois : lignes du fichier → calculs B2C, B2B et point financier du mois (paliers et objectif de CE mois). */
  async function calculMois(M) {
    const { b2c, b2b } = convertir(await lignesMois(M), M), o = regles(M);
    const c2c = b2c.length ? F.calculB2C(b2c, o) : null, c2b = b2b.length ? F.calculB2B(b2b, o) : null;
    return { mois: M, b2c, b2b, c2c, c2b, pf: c2c || c2b ? F.pointFinancier(c2c, c2b, o) : null };
  }
  async function depuisBase() {
    if (S.test) return;   // données de test chargées par CT.factUI.charger
    const liste = await listeMois(); await objectifsOperateur();
    if (!liste.length) { S.mois = null; S.moisSel = []; S.multi = false; S.parMois = []; S.b2c = S.b2b = null; S.cleBase = null; recalculer(); return; }
    const dispo = liste.map((x) => x.mois), sel = moisChoisis(dispo), cle = sel.join(',');
    if (S.cleBase === cle) return;
    const par = await Promise.all(sel.map(calculMois)), M = sel[sel.length - 1];
    const fichiers = [...new Set(sel.map((m) => (liste.find((x) => x.mois === m) || {}).fichiers).filter(Boolean))].join(' + ');
    const src = { fichier: fichiers || 'Fichier importé', onglet: sel.length > 1 ? libSelection(sel) : CT.date.libelleMois(M) };
    const tout = (k) => [].concat(...par.map((x) => x[k]));
    S.mois = M; S.moisSel = sel; S.multi = sel.length > 1; S.parMois = par;
    S.b2c = tout('b2c').length ? Object.assign({ lignes: tout('b2c'), ignorees: { sansDebit: 0 } }, src) : null;
    S.b2b = tout('b2b').length ? Object.assign({ lignes: tout('b2b') }, src) : null;
    if (S.multi) {   // cumul : chaque mois est calculé avec ses propres paliers, puis les montants sont additionnés
      S.c2c = fusionB2C(par); S.c2b = fusionB2B(par); S.pf = fusionPF(par);
    } else { S.c2c = par[0].c2c; S.c2b = par[0].c2b; S.pf = par[0].pf; }
    S.cleBase = cle;
  }
  /** « Août → Octobre 2026 », « Décembre 2026 → Février 2027 » */
  function libSelection(sel) {
    if (!sel || !sel.length) return '';
    if (sel.length === 1) return CT.date.libelleMois(sel[0]);
    const a = CT.date.libelleMois(sel[0]), b = CT.date.libelleMois(sel[sel.length - 1]);
    return (sel[0].slice(0, 4) === sel[sel.length - 1].slice(0, 4) ? a.split(' ')[0] : a) + ' → ' + b + ' (' + sel.length + ' mois)';
  }

  /* ---------- Cumul de plusieurs mois : addition des résultats mensuels (mêmes champs que calculB2C / calculB2B / pointFinancier) ---------- */
  const ajouter = (cible, src, cles) => cles.forEach((k) => { cible[k] = (cible[k] || 0) + ((src && src[k]) || 0); });
  function fusionLogins(listes, cles) {
    const m = new Map();
    listes.forEach((l) => (l || []).forEach((g) => {
      let a = m.get(g.loginKey);
      if (!a) { a = Object.assign({}, g, { parDebit: {} }); cles.forEach((k) => { a[k] = 0; }); m.set(g.loginKey, a); }
      ajouter(a, g, cles);
      Object.entries(g.parDebit || {}).forEach(([d, n]) => { a.parDebit[d] = (a.parDebit[d] || 0) + n; });
      if (!a.equipe && g.equipe) a.equipe = g.equipe;
    }));
    return [...m.values()];
  }
  const triDebits = (l) => [...new Set(l)].sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10) || a.localeCompare(b));
  function fusionB2C(par) {
    const L = par.filter((x) => x.c2c); if (!L.length) return null;
    const r = { segment: 'B2C', cumul: true, alertes: [], parDebit: {}, nonPayes: { reportes: 0, nonValides: 0 }, prixPrimePartenaire: null, objectif: null, objectifAtteint: null };
    L.forEach(({ mois, c2c: c }) => {
      ajouter(r, c, ['quantite', 'reportsPayes', 'oneShot', 'partVendeurs', 'partPartenaire', 'primeVendeurs', 'primePartenaire', 'primeObjectif', 'totalHT', 'tva', 'totalTTC']);
      ajouter(r.nonPayes, c.nonPayes, ['reportes', 'nonValides']);
      Object.entries(c.parDebit).forEach(([d, x]) => { const y = r.parDebit[d] || (r.parDebit[d] = { quantite: 0, oneShot: 0 }); y.quantite += x.quantite; y.oneShot += x.oneShot; });
      c.alertes.forEach((a) => r.alertes.push(Object.assign({}, a, { titre: CT.date.libelleMois(mois) + ' : ' + a.titre })));
    });
    r.debits = triDebits(Object.keys(r.parDebit));
    r.logins = fusionLogins(L.map((x) => x.c2c.logins), ['ventes', 'reports', 'oneShot', 'partVendeur', 'partPartenaire', 'primePerf', 'total']).sort((a, b) => b.ventes - a.ventes || a.loginKey.localeCompare(b.loginKey));
    return r;
  }
  function fusionB2B(par) {
    const L = par.filter((x) => x.c2b); if (!L.length) return null;
    const r = { segment: 'B2B', cumul: true, alertes: [], totalParDebit: {}, nonPayes: { reportes: 0 }, prixPrimePVT: null, moisVente: libSelection(par.map((x) => x.mois)) };
    L.forEach(({ mois, c2b: c }) => {
      ajouter(r, c, ['payees', 'reportsPayes', 'commVTB', 'primeVTB', 'commPVT', 'primePVT', 'totalHT', 'tva', 'totalTTC']);
      ajouter(r.nonPayes, c.nonPayes, ['reportes']);
      ajouter(r.totalParDebit, c.totalParDebit, Object.keys(c.totalParDebit));
      c.alertes.forEach((a) => r.alertes.push(Object.assign({}, a, { titre: CT.date.libelleMois(mois) + ' : ' + a.titre })));
    });
    r.debits = triDebits([].concat(...L.map((x) => x.c2b.debits)));
    r.logins = fusionLogins(L.map((x) => x.c2b.logins), ['ventes', 'reports', 'oneShot', 'commVTB', 'commPVT', 'primeVTB', 'totalVTB']).sort((a, b) => b.ventes - a.ventes || a.loginKey.localeCompare(b.loginKey));
    return r;
  }
  function fusionPF(par) {
    const L = par.filter((x) => x.pf); if (!L.length) return null;
    const cles = ['ventesB2C', 'ventesB2B', 'oneShotB2C', 'oneShotB2B', 'primeB2C', 'primeB2B', 'ventes', 'oneShot', 'partCommercial', 'partRGZ', 'aib', 'primes', 'net'];
    const lignes = fusionLogins(L.map((x) => x.pf.lignes), cles).sort((a, b) => b.net - a.net || a.loginKey.localeCompare(b.loginKey)), totaux = {};
    ajouter(totaux, {}, ['ventes', 'oneShot', 'partCommercial', 'partRGZ', 'aib', 'primes', 'net']);
    L.forEach((x) => ajouter(totaux, x.pf.totaux, Object.keys(totaux)));
    return { lignes, totaux, cumul: true };
  }


  /** Affiche la facture du mois m (barre « Mois facturé » ou après un import). */
  function choisirMois(m) { S.choix = m || null; S.cleBase = null; rendre(); }

  /* Barre « Mois facturé » de l'en-tête (pages Facturation, à la place des dates) :
       boutons « 3 derniers mois » + les 3 derniers mois importés ; « Autre période… » : depuis janvier, chaque année, chaque mois (classés par année).
     Valeurs : « m:AAAA-MM » (un mois) ou « p:AAAA-MM|AAAA-MM » (cumul de plusieurs mois). */
  function majBarreFacture(visible) {
    const zone = $('#fact-periode'), L = S.moisDispo || [];
    if (!zone) return;
    zone.hidden = !visible || !L.length; if (zone.hidden) return;
    const mois = L.map((x) => x.mois), der = mois[mois.length - 1], trois = mois.slice(-3), anDer = der.slice(0, 4);
    const cur = S.multi ? 'p:' + S.moisSel[0] + '|' + S.moisSel[S.moisSel.length - 1] : 'm:' + S.mois;
    // Mots entiers, sans abréviation ; l'année n'est écrite que sur le premier mois de chaque année (« Septembre 2026 · Octobre · Janvier 2027 »),
    // et pas du tout si les trois mois sont de l'année en cours
    const annees = new Set(trois.map((m) => m.slice(0, 4))).size > 1 || anDer !== String(new Date().getFullYear());
    const lib = (m) => { const l = CT.date.libelleMois(m), i = trois.indexOf(m); return annees && (i <= 0 || trois[i - 1].slice(0, 4) !== m.slice(0, 4)) ? l : l.split(' ')[0]; };
    const b = (trois.length > 1 ? [['p:' + trois[0] + '|' + der, trois.length + ' derniers mois', 'Cumul de ' + trois.map((m) => CT.date.libelleMois(m)).join(', ')]] : [])
      .concat(trois.map((m) => ['m:' + m, lib(m), 'Facture de ' + CT.date.libelleMois(m)]));
    const btns = $('#fp-mois'), html = b.map(([v, t, ti]) => `<button type="button" class="pb-btn" data-fmois="${v}" aria-pressed="${v === cur}" title="${esc(ti)}">${esc(t)}</button>`).join('');
    if (btns.innerHTML !== html) btns.innerHTML = html;
    const sel = $('#fp-autre'), opt = (v, t) => `<option value="${v}">${esc(t)}</option>`, ans = [...new Set(mois.map((m) => m.slice(0, 4)))].sort().reverse();
    const janv = mois.filter((m) => m.slice(0, 4) === anDer);
    let h = opt('', mois.length > 1 ? 'Autre période…' : '1 seul mois importé');
    if (janv.length > 1) h += opt('p:' + janv[0] + '|' + der, 'Depuis janvier ' + anDer + ' (' + janv.length + ' mois)');
    if (mois.length > 3) h += opt('p:' + mois[0] + '|' + der, 'Tous les mois importés (' + mois.length + ' mois)');
    ans.forEach((an) => {
      const ms = mois.filter((m) => m.slice(0, 4) === an);
      h += `<optgroup label="${an}">` + (ms.length > 1 ? opt('p:' + ms[0] + '|' + ms[ms.length - 1], 'Année ' + an + ' (' + ms.length + ' mois)') : '') + ms.slice().reverse().map((m) => opt('m:' + m, CT.date.libelleMois(m))).join('') + '</optgroup>';
    });
    if (sel.dataset.html !== h) { sel.innerHTML = h; sel.dataset.html = h; }
    sel.disabled = mois.length < 2;
    // Le choix reste visible : bouton enfoncé, sinon l'option de la liste
    sel.value = b.some(([v]) => v === cur) ? '' : ([...sel.options].some((o) => o.value === cur) ? cur : '');
  }

  /* Historique des fichiers de facture importés (15 derniers) */
  async function historique() {
    if (!S.historique) { try { S.historique = ((await CT.api.factures.imports()) || {}).imports || []; } catch (e) { S.historique = []; } }
    return S.historique;
  }
  const depuis = (iso) => { const d = (Date.now() - new Date(iso).getTime()) / 60000; return d < 1 ? 'à l\'instant' : d < 60 ? 'il y a ' + Math.round(d) + ' min' : d < 1440 ? 'il y a ' + Math.round(d / 60) + ' h' : 'le ' + new Date(iso).toLocaleDateString('fr-FR'); };
  function carteHistorique() {
    const H = S.historique || [], lib = { ok: ['fa-check', '', 'Réussi', 'badge-pos'], modifie: ['fa-pen', 'warn', 'Modifié', 'badge-warn'], echec: ['fa-xmark', 'neg', 'Échec', 'badge-neg'], en_cours: ['fa-spinner', 'info', 'En cours', 'badge-info'] };
    return `<section class="card"><div class="card-head"><div><h3>Historique des fichiers</h3><p>Fichiers de facture importés${H.length > 6 ? ' · ' + H.length + ' derniers, faites défiler' : ''}</p></div></div>
      <ul class="activity">${H.map((i) => { const [ic, cls, txt, badge] = lib[i.statut === 'ok' && i.remplacees ? 'modifie' : i.statut] || lib.en_cours;   // un mois déjà importé puis remplacé : « Modifié »
        const ch = i.changements, detCh = ch ? ' · mis à jour : ' + [[ch.nouvelles, 'nouvelle(s)'], [ch.modifiees, 'modifiée(s)'], [ch.retirees, 'retirée(s)']].filter((x) => x[0]).map((x) => mn(x[0]) + ' ' + x[1]).join(', ') + (ch.nouvelles || ch.modifiees || ch.retirees ? '' : 'aucun changement') : ' · remplace l\'import précédent';
        const det = i.statut === 'ok' ? (i.mois ? CT.date.libelleMois(i.mois) + ' · ' : '') + mn(i.facturees || 0) + ' facturée(s)' + (i.arrieres ? ' dont ' + mn(i.arrieres) + ' arriéré(s)' : '') + ' · ' + mn(i.reportees || 0) + ' reportée(s)' + (i.remplacees ? detCh : '') : (i.erreur || '');
        return `<li><span class="ic ${cls}" aria-hidden="true"><i class="fa-solid ${ic}"></i></span><div><div class="nm" title="${esc(i.nom)}">${esc(i.nom)}</div><small title="${esc(det + (i.feuilles && i.feuilles.length ? ' · feuilles : ' + i.feuilles.join(', ') : ''))}">${esc(det)}</small></div><div style="text-align:right"><span class="badge ${badge}">${txt}</span><small>${i.date ? depuis(i.date) : ''}</small></div></li>`; }).join('') || '<li class="muted">Aucun fichier importé.</li>'}</ul></section>`;
  }

  /* ---------- Import des fichiers « POINT VENTES » (bouton du Résumé de la facturation, plusieurs fichiers possibles) ---------- */
  /* Fenêtre « Contrôle avant import » (même présentation que le Tableau de bord général) : chiffres du fichier et, si le mois
     est déjà en base, ce qui va changer. Renvoie true seulement si l'utilisateur confirme ; rien n'est écrit avant. */
  function controleAvantImport(a) {
    const s = a.stats, c = a.comparaison, mois = CT.date.libelleMois(s.mois), dejaLa = c.existantes > 0;
    const it = (niv, ic, titre, detail) => `<li class="qc-item ${niv}"><span class="qc-ic" aria-hidden="true"><i class="fa-solid ${ic}"></i></span><div><strong>${titre}</strong>${detail ? `<small>${detail}</small>` : ''}</div></li>`;
    const debits = Object.entries(s.par_debit || {}).map(([d, n]) => esc(d) + ' : ' + mn(n)).join(' · ');
    const items = [
      it('ok', 'fa-calendar', 'Mois facturé : ' + esc(mois), 'Feuille(s) lue(s) : ' + s.feuilles.map((x) => '« ' + esc(x.nom) + ' » (' + mn(x.lignes) + ' lignes)').join(', ')
        + (s.feuilles_ignorees && s.feuilles_ignorees.length ? ' · ignorée(s) : ' + s.feuilles_ignorees.map(esc).join(', ') : '')),
      it('ok', 'fa-file-invoice-dollar', 'Facturées : ' + mn(s.facturees) + ' (' + mn(s.a_payer) + ' à payer' + (s.arrieres ? ' + ' + mn(s.arrieres) + ' arriéré(s)' : '') + ')', debits + (s.logins ? ' · ' + mn(s.logins) + ' vendeur(s)' : '')),
      it(s.reportees ? 'warn' : 'ok', 'fa-clock', 'Paiements reportés : ' + mn(s.reportees), 'Non facturés ce mois.'),
      it(s.non_validees ? 'warn' : 'ok', 'fa-ban', 'Ventes non validées : ' + mn(s.non_validees), 'Non facturées.'),
    ].concat((s.avertissements || []).map((w) => it('warn', 'fa-exclamation', 'Attention', esc(w))));
    if (c.identique) items.push(it('ok', 'fa-equals', esc(mois) + ' déjà importé : fichier identique à la base', 'Aucune vente nouvelle, modifiée ou retirée : rien ne sera réécrit.'));
    else if (dejaLa) items.push(it('warn', 'fa-pen', esc(mois) + ' déjà en base (' + mn(c.existantes) + ' lignes' + (c.fichiers_existants.length ? ', ' + c.fichiers_existants.map((x) => '« ' + esc(x) + ' »').join(', ') : '') + ') : mise à jour',
      mn(c.nouvelles) + ' nouvelle(s) · ' + mn(c.modifiees) + ' modifiée(s) · ' + mn(c.retirees) + ' retirée(s) · ' + mn(c.inchangees) + ' inchangée(s). Les lignes de ce mois sont remplacées : aucun doublon.'
        + (c.exemples.length ? '<br>Exemples : ' + c.exemples.map(esc).join(' ; ') : '')));
    else items.push(it('ok', 'fa-plus', 'Nouveau mois : ' + esc(mois) + ' n\'est pas encore en base', mn(s.lignes) + ' lignes seront enregistrées.'));
    const corps = `<p class="muted" style="margin-bottom:12px">${esc(a.fichier)} · ${mn(s.lignes)} lignes exploitables. Rien n'est enregistré tant que vous n'avez pas confirmé.</p><ul class="qc-list">${items.join('')}</ul>`;
    return CT.modal({ titre: 'Contrôle avant import — ' + mois, corps,
      actions: c.identique ? [{ label: 'Fermer', valeur: false, variante: 'primary' }]
        : [{ label: 'Annuler', valeur: false }, { label: dejaLa ? 'Mettre à jour ' + mois : 'Enregistrer ' + mois, valeur: true, variante: 'primary' }] });
  }
  async function importerFactures(fichiers) {
    const bilan = []; let dernier = null;
    for (const f of fichiers) {
      if (!/\.(xlsx|xls)$/i.test(f.name)) { CT.toast('« ' + f.name + ' » refusé : seuls les fichiers Excel (.xlsx, .xls) sont acceptés.', 'err', 8000); continue; }
      const info = $('#fact-import-msg'); if (info) info.textContent = 'Lecture de « ' + f.name + ' »…';
      try {
        const a = await CT.api.factures.apercu(f);
        if (info) info.textContent = '';
        if (!(await controleAvantImport(a))) {
          CT.toast(a.comparaison.identique ? '« ' + f.name + ' » est identique à la base : rien n\'a été modifié.' : 'Import de « ' + f.name + ' » annulé : rien n\'a été modifié.', 'info', 5000);
          continue;
        }
        if (info) info.textContent = 'Enregistrement de « ' + f.name + ' »…';
        const r = await CT.api.factures.importer(f, a.stats.mois);
        bilan.push(r.message); dernier = r.stats.mois;
        (r.stats.avertissements || []).forEach((w) => CT.toast(w, 'warn', 9000));
      } catch (e) {
        await CT.modal({ titre: 'Fichier non enregistré', actions: [{ label: 'Compris', valeur: true, variante: 'primary' }],
          corps: '<div class="alert neg"><span class="alert-ic">' + CT.icone('critique') + '</span><div><strong>' + esc(f.name) + '</strong><span>' + esc(e.message) + '</span></div></div>'
            + '<p class="muted" style="margin-top:12px">Rien n\'a été enregistré pour ce fichier : la base est restée dans son état précédent.</p>' });
      }
    }
    if (bilan.length) CT.toast(bilan.join(' · '), 'ok', 12000);
    oublier(); if (dernier) choisirMois('m:' + dernier); else rendre();
  }
  /** Carte « Fichier de facture » en tête du Résumé de la facturation (même présentation que le Tableau de bord général). */
  function carteImport() {
    const L = S.moisDispo || [], choix = '', sel = L.filter((x) => (S.moisSel || [S.mois]).includes(x.mois));
    // Un mois : son fichier ; plusieurs mois : totaux additionnés et nombre de fichiers
    const info = !sel.length ? null : sel.length === 1 ? sel[0] : { mois: S.mois, fichiers: sel.length + ' mois cumulés : ' + sel.map((x) => CT.date.libelleMois(x.mois)).join(', '),
      a_payer: CT.somme(sel, (x) => x.a_payer), arrieres: CT.somme(sel, (x) => x.arrieres), reportees: CT.somme(sel, (x) => x.reportees), non_validees: CT.somme(sel, (x) => x.non_validees) };
    return `<section class="card flat no-print" aria-label="Fichier de facture">
      <div class="file-chip"><div><div class="kpi-label">Fichier de facture (POINT VENTES)</div>
        <strong>${info ? esc(info.fichiers) : 'Aucun fichier importé'}</strong>
        <div class="kpi-sub">${info ? esc(sel.length > 1 ? libSelection(S.moisSel) : CT.date.libelleMois(info.mois)) + ' · ' + mn(info.a_payer) + ' à payer · ' + mn(info.arrieres) + ' arriéré(s) · ' + mn(info.reportees) + ' paiement(s) reporté(s) · ' + mn(info.non_validees) + ' non validée(s)'
          : 'Feuilles lues : « Liste (des) clients » et « Liste des arriérés ». Facturées : lignes A PAYER + arriérés.'}</div>
        <div class="mini-cap" id="fact-import-msg" aria-live="polite"></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">${choix}
          <label class="btn ${info ? 'btn-secondary' : 'btn-primary'}" for="fact-fichier"><i class="fa-solid ${info ? 'fa-file-circle-plus' : 'fa-file-import'}" aria-hidden="true"></i>${info ? 'Ajouter un nouveau fichier' : 'Importer le fichier'}</label>
          <input type="file" id="fact-fichier" accept=".xlsx,.xls" multiple hidden></div></div></section>`;
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
    const d = S[seg], n = (p) => (d ? d.lignes.filter((l) => l.paiement === p).length : 0);
    const arr = d ? d.lignes.filter((l) => l.liste === 'arrieres' && (l.paiement === 'PAYE' || l.paiement === 'REPORT_PAYE')).length : 0;
    return `<section class="card no-print fact-source"><div class="card-head"><div><h3>${S.multi ? 'Fichiers de ' + esc(libSelection(S.moisSel)) : 'Fichier de ' + (S.mois ? esc(CT.date.libelleMois(S.mois)) : '—')}${d ? ' · ' + esc(d.fichier) : ''}</h3>
      <p>Facture calculée depuis le fichier « POINT VENTES » importé dans <a class="lien-nu" href="#facturation">Facturation › Résumé</a> (feuilles « Liste des clients » et « Liste des arriérés »). Lignes <b>A PAYER</b> + <b>arriérés</b> = facturées ; <b>PAIEMENT REPORTE</b> = reportées ; <b>VENTE NON VALIDEE</b> = non facturées.</p></div></div>
      <p class="muted">${seg.toUpperCase()} : ${mn(n('PAYE') + n('REPORT_PAYE') - arr)} à payer · ${mn(arr)} arriéré(s) · ${mn(n('REPORTE'))} reportée(s) · ${mn(n('NON_VALIDE'))} non validée(s)</p></section>`;
  }
  const sansFichier = (texte) => texte;
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

  /* ---------- Cumul : une facture officielle par mois (la facture normalisée est mensuelle) ---------- */
  function lignesParMois(seg) {
    return (S.parMois || []).map((x) => { const c = seg === 'b2c' ? x.c2c : x.c2b; return { mois: x.mois, lib: CT.date.libelleMois(x.mois), ventes: c ? (seg === 'b2c' ? c.quantite : c.payees) : 0, ht: c ? c.totalHT : 0, ttc: c ? c.totalTTC : 0, c }; });
  }
  function facturesParMoisHTML(seg) {
    const L = lignesParMois(seg), n = CT.fmt.mnt;
    return `<p class="muted">La facture normalisée est mensuelle : voici celle de chaque mois de la période (chaque mois a ses propres paliers de primes). « Voir » ouvre la facture complète du mois.</p>
      <div class="table-wrap"><table class="table-compact"><caption class="sr-only">Factures ${seg.toUpperCase()} par mois</caption>
        <thead><tr><th scope="col">Mois</th><th scope="col" class="num">Ventes facturées</th><th scope="col" class="num">Total HT</th><th scope="col" class="num">Total TTC</th><th scope="col"></th></tr></thead>
        <tbody>${L.map((x) => `<tr><td>${esc(x.lib)}</td><td class="num">${mn(x.ventes)}</td><td class="num">${n(x.ht)}</td><td class="num">${n(x.ttc)}</td><td>${x.c ? `<button type="button" class="btn btn-ghost btn-sm" data-fmois="m:${x.mois}"><i class="fa-solid fa-file-invoice" aria-hidden="true"></i>Voir</button>` : '<span class="muted">aucune vente</span>'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th scope="row">TOTAL</th><td class="num"><b>${mn(CT.somme(L, (x) => x.ventes))}</b></td><td class="num"><b>${n(CT.somme(L, (x) => x.ht))}</b></td><td class="num"><b>${n(CT.somme(L, (x) => x.ttc))}</b></td><td></td></tr></tfoot>
      </table></div>`;
  }
  const facturesParMoisDef = (seg) => { const L = lignesParMois(seg); return { nom: 'Factures ' + seg.toUpperCase() + ' par mois', cols: [20, 16, 18, 18], aoa: [['Mois', 'Ventes facturées', 'Total HT (FCFA)', 'Total TTC (FCFA)']].concat(L.map((x) => [x.lib, x.ventes, x.ht, x.ttc])) }; };

  /* ---------- Facturation B2C ---------- */
  function feuillesB2C() {
    const c = S.c2c, deb = c.debits;
    return [
      S.multi ? facturesParMoisDef('b2c') : Object.assign({ nom: 'Facture B2C', cols: [12, 52, 14, 10, 18] }, factureDef(F.facture(c, regles()), titreFacture('b2c'))),
      { nom: 'B2C par login', cols: [26, 14, 10, 10].concat(deb.map(() => 12), [14, 14, 14, 16, 16]),
        aoa: [['Login', 'Équipe', 'Ventes', 'dont reports'].concat(deb, ['One-shot (FCFA)', 'Part vendeur (FCFA)', 'Part partenaire (FCFA)', 'Prime perf. (FCFA)', 'Total vendeur (FCFA)'])]
          .concat(c.logins.map((g) => [g.login, g.equipe, g.ventes, g.reports].concat(deb.map((d) => g.parDebit[d] || 0), [g.oneShot, g.partVendeur, g.partPartenaire, g.primePerf, g.total]))) },
    ];
  }
  function vueB2C() {
    const root = $('#factb2c-content'), c = S.c2c;
    const imp = zoneBase('b2c');
    if (!c) { root.innerHTML = imp + vide('b2c', sansFichier('Aucune vente FTTH Home à facturer. Importez le fichier « POINT VENTES » du mois dans Facturation › Résumé.')); return; }
    const params = '';
    root.innerHTML = imp + `<div class="stack">${alertes(c.alertes)}
      ${tuiles([
        { icone: 'fa-wifi', ton: 'pos', titre: 'Ventes facturables', valeur: mn(c.quantite), aide: Object.keys(c.parDebit).map((d) => mn(c.parDebit[d].quantite) + ' × ' + d.replace('FTTH_HOME_', '')).join(' · ') + (c.reportsPayes ? ' · dont ' + mn(c.reportsPayes) + ' report(s) payé(s)' : '') },
        { icone: 'fa-coins', titre: 'One-shot', valeur: fc(c.oneShot), aide: 'Vendeurs ' + fc(c.partVendeurs) + ' · Partenaire ' + fc(c.partPartenaire) },
        { icone: 'fa-medal', ton: 'warn', titre: 'Primes', valeur: fc(c.primeVendeurs + c.primePartenaire + c.primeObjectif), aide: 'Vendeurs ' + fc(c.primeVendeurs) + ' · Partenaire ' + fc(c.primePartenaire) + ' · Objectif ' + fc(c.primeObjectif) },
        { icone: 'fa-file-invoice-dollar', ton: 'pos', titre: 'Total HT à facturer', valeur: fc(c.totalHT), aide: 'TTC (TVA 18 %) : ' + fc(c.totalTTC) }])}
      ${c.cumul ? CT.ui.enClair('Cumul de <b>' + esc(libSelection(S.moisSel)) + '</b> : chaque mois est facturé avec ses propres paliers et son objectif, puis les montants sont additionnés. Prime partenaire indexée (objectif FTTH) cumulée : <b>' + fc(c.primeObjectif) + '</b>.', 'fa-layer-group') : ''}
      ${carteObjectif()}
      ${CT.ui.enClair('Non facturées : <b>' + mn(c.nonPayes.reportes) + '</b> ventes au paiement reporté et <b>' + mn(c.nonPayes.nonValides) + '</b> ventes non validées.', 'fa-hourglass-half')}
      ${params}
      <section class="card"><div class="card-head"><div><h3>${S.multi ? 'Factures B2C par mois' : 'Facture B2C'}</h3><p>${S.multi ? esc(libSelection(S.moisSel)) : 'Modèle de la facture normalisée : prix et montants TTC (TVA 18 %), puis ventilation HT / impôt'}</p></div>${bouton('xl-b2c', 'fa-file-excel', 'Excel')}</div><div id="tb-fb2c"></div></section>
      <section class="card"><div class="card-head"><div><h3>Commissions par login</h3><p>Quantités par débit, one-shot (80 % vendeur / 20 % partenaire) et prime de performance</p></div></div><div id="tb-lb2c"></div></section></div>`;
    const deb = c.debits;
    $('#tb-fb2c').innerHTML = S.multi ? facturesParMoisHTML('b2c') : factureHTML(F.facture(c, regles()), titreFacture('b2c'));
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
    if (!c) { root.innerHTML = imp + vide('b2b', sansFichier('Aucune vente B2B (FTTH_PRO, FIBRE…) dans le fichier « POINT VENTES » de ce mois.')); return; }
    root.innerHTML = imp + `<div class="stack">${alertes(c.alertes)}
      ${tuiles([
        { icone: 'fa-building', ton: 'pos', titre: 'Ventes payées', valeur: mn(c.payees), aide: 'Dont ' + mn(c.reportsPayes) + ' report(s) payé(s) · ' + mn(c.nonPayes.reportes) + ' paiement(s) reporté(s) non facturé(s)' },
        { icone: 'fa-coins', titre: 'Commissions', valeur: fc(c.commVTB + c.commPVT), aide: 'Vendeurs (80 %) ' + fc(c.commVTB) + ' · Partenaire (20 %) ' + fc(c.commPVT) },
        { icone: 'fa-medal', ton: 'warn', titre: 'Primes', valeur: fc(c.primeVTB + c.primePVT), aide: 'Vendeurs ' + fc(c.primeVTB) + ' · Partenaire ' + fc(c.primePVT) + (c.prixPrimePVT != null ? ' (' + mn(c.prixPrimePVT) + ' × ' + mn(c.payees) + ')' : ' (calculée mois par mois)') },
        { icone: 'fa-file-invoice-dollar', ton: 'pos', titre: 'Total HT à facturer', valeur: fc(c.totalHT), aide: 'TTC (TVA 18 %) : ' + fc(c.totalTTC) }])}
      ${CT.ui.enClair('La prime vendeur se calcule sur les ventes payées <b>hors reports</b> ; la prime partenaire sur <b>toutes</b> les ventes payées (reports compris). ' + (c.cumul ? 'Cumul de <b>' + esc(c.moisVente) + '</b>, chaque mois calculé avec ses propres paliers.' : 'Mois de vente : <b>' + esc(c.moisVente) + '</b>.'), 'fa-circle-info')}
      <section class="card"><div class="card-head"><div><h3>${S.multi ? 'Factures B2B par mois' : 'Facture B2B'}</h3><p>${S.multi ? esc(libSelection(S.moisSel)) : 'Modèle de la facture normalisée : one-shot par offre, prime du partenaire, primes de performance des vendeurs (hors reports)'}</p></div>${bouton('xl-fb2b', 'fa-file-excel', 'Excel')}</div><div id="tb-fb2b"></div></section>
      <section class="card"><div class="card-head"><div><h3>Récapitulatif B2B par login</h3><p>Équivalent des onglets COMM et RECAP du fichier de facturation</p></div>${bouton('xl-b2b', 'fa-file-excel', 'Excel')}</div><div id="tb-lb2b"></div></section></div>`;
    $('#tb-fb2b').innerHTML = S.multi ? facturesParMoisHTML('b2b') : factureHTML(F.facture(c, regles()), titreFacture('b2b'));
    $('#tb-lb2b').append(creer({ pageSize: 15, recherche: true, caption: 'Facturation B2B par login', lignes: c.logins, triInit: { cle: 'ventes', dir: 'desc' }, classeLigne: (g) => (g.anonymat ? 'row-hors' : ''),
      colonnes: [{ cle: 'login', titre: 'Login', fmt: (v, g) => nomLogin(g.loginKey) + (g.anonymat ? ' (Anonymat)' : '') }].concat(c.debits.map((d) => ({ cle: 'd_' + d, titre: d.replace(/^FIBRE_|^FTTH_/, ''), num: true, tri: (g) => g.parDebit[d] || 0, fmt: (v, g) => mn(g.parDebit ? g.parDebit[d] || 0 : v) })),
        [{ cle: 'ventes', titre: 'Ventes', num: true, fmt: mn }, { cle: 'reports', titre: 'dont reports', num: true, fmt: mn }, { cle: 'commVTB', titre: 'Comm. vendeur (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'primeVTB', titre: 'Prime vendeur (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'totalVTB', titre: 'Total vendeur HT (FCFA)', num: true, html: true, fmt: (v) => '<b>' + CT.fmt.mnt(v) + '</b>' }, { cle: 'commPVT', titre: 'Comm. partenaire (FCFA)', num: true, fmt: CT.fmt.mnt }]),
      pied: Object.assign({ login: 'TOTAL', ventes: c.payees, reports: c.reportsPayes, commVTB: c.commVTB, primeVTB: c.primeVTB, totalVTB: c.commVTB + c.primeVTB, commPVT: c.commPVT }, ...c.debits.map((d) => ({ ['d_' + d]: c.totalParDebit[d] }))) }));
  }
  function feuillesB2B() {
    const c = S.c2b;
    return [
      S.multi ? facturesParMoisDef('b2b') : Object.assign({ nom: 'Facture B2B', cols: [12, 52, 14, 10, 18] }, factureDef(F.facture(c, regles()), titreFacture('b2b'))),
      { nom: 'RECAP B2B', cols: [34, 18], aoa: [['Rubrique', 'Montant HT (FCFA)'], ['Ventes payées', c.payees], ['dont reports payés', c.reportsPayes], ['Commission vendeur', c.commVTB], ['Prime vendeur', c.primeVTB], ['Commission partenaire', c.commPVT], ['Prime partenaire (' + mn(c.prixPrimePVT) + ' × ' + mn(c.payees) + ')', c.primePVT], ['Total HT', c.totalHT], ['TVA 18 %', c.tva], ['Total TTC', c.totalTTC]], total: false },
      { nom: 'COMM B2B', cols: [26].concat(c.debits.map(() => 14), [10, 12, 16, 16, 18, 18]),
        aoa: [['Login'].concat(c.debits, ['Ventes', 'dont reports', 'Comm. vendeur (FCFA)', 'Prime vendeur (FCFA)', 'Total vendeur HT (FCFA)', 'Comm. partenaire (FCFA)'])]
          .concat(c.logins.map((g) => [g.login].concat(c.debits.map((d) => g.parDebit[d] || 0), [g.ventes, g.reports, g.commVTB, g.primeVTB, g.totalVTB, g.commPVT]))) },
    ];
  }

  /* ---------- Point financier par login ---------- */
  function vueFinance() {
    const root = $('#finance-content'), p = S.pf;
    const note = (S.b2c ? '' : '<li>Aucune vente B2C (FTTH Home) dans le fichier de ce mois.</li>') + (S.b2b ? '' : '<li>Aucune vente B2B (FTTH_PRO, FIBRE…) dans le fichier de ce mois.</li>');
    if (!p) { root.innerHTML = vide('', sansFichier('Aucune facture pour le moment. Importez le fichier « POINT VENTES » du mois dans Facturation › Résumé.')) + `<p class="muted"><a class="lien-nu" href="#facturation-b2c">Aller à la facturation B2C</a> · <a class="lien-nu" href="#facturation-b2b">Aller à la facturation B2B</a></p>`; return; }
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
    if (!L.length) { root.innerHTML = vide('', sansFichier('Aucune facture pour le moment. Importez le fichier « POINT VENTES » du mois dans Facturation › Résumé.')); return; }
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
  const moisFact = () => (S.multi ? libSelection(S.moisSel) : S.mois ? CT.date.libelleMois(S.mois) : '');
  const deMois = (t) => (/^[aeiouyhâ]/i.test(t) ? 'd\'' : 'de ') + t.charAt(0).toLowerCase() + t.slice(1);   // « d'octobre 2026 », « de septembre 2026 »

  function vueDash() {
    const root = $('#factdash-content'), c = S.c2c, d = S.c2b;
    if (!c && !d) {
      const L = S.moisDispo || [];
      const texte = !L.length ? 'Aucun fichier de facture importé : cliquez sur « Importer le fichier » et choisissez le fichier « POINT VENTES » du mois (B2C et B2B, ensemble ou séparément).'
        : 'Aucune ligne facturée (A PAYER ou arriéré) dans le fichier de ce mois.';
      root.innerHTML = `<div class="stack">${carteImport()}${vide2(texte)}${S.historique && S.historique.length ? carteHistorique() : ''}</div>`; return;
    }
    const r = synthese(c, d), A = CT.analyse, pr = CT.etat.prioritaire;
    root.innerHTML = `<div class="stack">
      ${carteImport()}
      ${CT.ui.enClair(S.multi ? 'Cumul de <b>' + esc(libSelection(S.moisSel)) + '</b> : chaque mois est facturé avec ses propres paliers et son objectif, puis les montants sont additionnés (mêmes règles que les pages Facture B2C et Facture B2B).' : 'Factures de ' + esc(moisFact()) + ', calculées depuis le fichier « POINT VENTES » importé (lignes A PAYER + arriérés) : mêmes montants que les pages Facture B2C et Facture B2B.', 'fa-circle-info')}
      <div class="grid-kpi">
        ${A.kpi('fa-file-invoice-dollar', 'pos', 'Total à facturer TTC', fc(r.ttc), 'HT ' + fc(r.ht) + ' · TVA 18 % ' + fc(r.tva))}
        ${A.kpi('fa-house-signal', 'info', 'Facture B2C (HT)', fc(r.htB2C), mn(r.ventesB2C) + ' ventes facturées')}
        ${A.kpi('fa-building', 'info', 'Facture B2B (HT)', fc(r.htB2B), mn(r.ventesB2B) + ' ventes facturées')}
        ${A.kpi('fa-hourglass-half', r.reportes ? 'warn' : '', 'Reportées', mn(r.reportes), 'non facturées ce mois (PAIEMENT REPORTE)')}
        ${A.kpi('fa-sack-dollar', 'pos', 'Net ' + esc(pr), fc(r.netRgz), pcx(r.ht ? r.netRgz / r.ht : null) + ' de la facture HT')}
        ${A.kpi('fa-user-tie', '', 'Reversé aux vendeurs', fc(r.vendeurs), 'commissions + primes vendeurs')}</div>
      <div class="grid-2">
        ${A.carte('fd-donut', 'Rémunération ' + esc(pr) + ' — répartition', 'Ce que ' + esc(pr) + ' garde : part des commissions, primes partenaire, prime indexée sur l\'objectif FTTH', '<div class="chart-box"><canvas id="fd-ch-donut" role="img" aria-label="Répartition de la rémunération"></canvas></div>')}
        ${A.carte('fd-struct', 'Structure de la facture B2C vs B2B', 'Montants HT : one-shot, primes des vendeurs, primes du partenaire', '<div class="chart-box"><canvas id="fd-ch-struct" role="img" aria-label="Structure de la facture"></canvas></div>')}</div>
      <div class="grid-2">
        ${A.carte('fd-b2c', 'Détail B2C', esc(moisFact()), '<div id="fd-t-b2c"></div>')}
        ${A.carte('fd-b2b', 'Détail B2B', esc(moisFact()), '<div id="fd-t-b2b"></div>')}</div>
      ${(() => { const c0 = S.c2c, l = '<a class="lien-nu" href="#facturation-b2c">Facture B2C</a>';
        if (S.multi) { const n = S.parMois.filter((x) => S.objOp[x.mois]).length; return CT.ui.enClair('Prime partenaire indexée (objectif FTTH de l\'opérateur) : <b>' + fc(r.primeObjectif) + '</b> sur la période · objectif saisi pour ' + n + ' mois sur ' + S.parMois.length + ' (' + l + ').', 'fa-bullseye'); }
        const o = S.objOp[S.mois];
        if (!o) return CT.ui.enClair('Objectif FTTH de l\'opérateur non saisi pour ' + esc(moisFact()) + ' : facture sans la prime partenaire indexée. Saisissez-le dans ' + l + '.', 'fa-bullseye');
        return CT.ui.enClair('Objectif FTTH de l\'opérateur : <b>' + mn(o) + '</b> ventes · ventes du mois : <b>' + mn(c0 ? c0.ventesObjectif : 0) + '</b> → ' + (c0 && c0.objectifAtteint ? 'atteint, prime partenaire indexée de <b>' + fc(c0.primeObjectif) + '</b> HT' : 'non atteint, pas de prime') + ' (' + l + ').', c0 && c0.objectifAtteint ? 'fa-face-smile' : 'fa-bullseye'); })()}
      ${S.multi ? A.carte('fd-mois', 'Factures par mois', 'Chaque mois de la période · la loupe ouvre le mois seul', '<div id="fd-t-mois"></div>') : ''}
      <div class="grid-3-1">${A.carte('fd-net', 'Rémunération nette ' + esc(pr), 'Facture HT = reversé aux vendeurs + net ' + esc(pr), '<div id="fd-t-net"></div>')}${carteHistorique()}</div></div>`;
    if (S.multi) {
      const lm = S.parMois.map((x) => Object.assign({ cle: x.mois, lib: CT.date.libelleMois(x.mois) }, synthese(x.c2c, x.c2b)));
      $('#fd-t-mois').append(creer({ pageSize: 0, caption: 'Factures par mois', lignes: lm, colonnes: [{ cle: 'lib', titre: 'Mois' }, { cle: 'ventesB2C', titre: 'Ventes B2C', num: true, fmt: mn }, { cle: 'ventesB2B', titre: 'Ventes B2B', num: true, fmt: mn },
        { cle: 'reportes', titre: 'Reportées', num: true, fmt: mn }, { cle: 'ht', titre: 'Facture HT (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'ttc', titre: 'TTC (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'vendeurs', titre: 'Vendeurs (FCFA)', num: true, fmt: CT.fmt.mnt },
        { cle: 'netRgz', titre: 'Net ' + pr + ' (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'voir', titre: '', html: true, tri: false, fmt: (v, x) => `<button type="button" class="btn btn-ghost btn-sm btn-icone" data-fmois="m:${x.cle}" title="Voir la facture de ${esc(x.lib)}" aria-label="Voir la facture de ${esc(x.lib)}"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></button>` }],
        pied: { lib: 'TOTAL', ventesB2C: r.ventesB2C, ventesB2B: r.ventesB2B, reportes: r.reportes, ht: r.ht, ttc: r.ttc, vendeurs: r.vendeurs, netRgz: r.netRgz } }));
    }
    const t = (id, l) => $(id).append(creer({ pageSize: 0, caption: id, lignes: l.filter((x) => x.m || x.toujours), colonnes: [{ cle: 'r', titre: 'Rubrique' }, { cle: 'm', titre: 'Montant HT (FCFA)', num: true, fmt: CT.fmt.mnt }], pied: { r: 'TOTAL HT', m: CT.somme(l, (x) => x.m) } }));
    t('#fd-t-b2c', [{ r: 'One-shot (' + mn(r.ventesB2C) + ' ventes)', m: r.oneShotB2C, toujours: 1 }, { r: 'Primes de performance vendeurs', m: r.primesVendB2C }, { r: 'Prime de performance partenaire', m: r.primePartB2C }, { r: 'Prime partenaire indexée (objectif FTTH)', m: r.primeObjectif }]);
    t('#fd-t-b2b', [{ r: 'One-shot (' + mn(r.ventesB2B) + ' ventes)', m: r.oneShotB2B, toujours: 1 }, { r: 'Primes vendeurs (hors reports)', m: r.primesVendB2B }, { r: 'Prime partenaire', m: r.primePartB2B }]);
    $('#fd-t-net').append(creer({ pageSize: 0, caption: 'Rémunération nette', lignes: [
      { r: 'Part ' + pr + ' des commissions B2C (20 %, Anonymat 0 %)', g: r.partRgzB2C }, { r: 'Part ' + pr + ' des commissions B2B (20 %)', g: r.partRgzB2B }, { r: 'Prime de performance partenaire B2C', g: r.primePartB2C },
      { r: 'Prime partenaire B2B', g: r.primePartB2B }, { r: 'Prime partenaire indexée (objectif FTTH de l\'opérateur)', g: r.primeObjectif }, { r: 'Reversé aux vendeurs B2C (commissions + primes)', v: r.vendeursB2C }, { r: 'Reversé aux vendeurs B2B (commissions + primes)', v: r.vendeursB2B }],
      colonnes: [{ cle: 'r', titre: 'Rubrique' }, { cle: 'g', titre: 'Net ' + pr + ' (FCFA)', num: true, fmt: (v) => (v == null ? '' : CT.fmt.mnt(v)) }, { cle: 'v', titre: 'Vendeurs (FCFA)', num: true, fmt: (v) => (v == null ? '' : CT.fmt.mnt(v)) }],
      pied: { r: 'TOTAL (= facture HT ' + CT.fmt.mnt(r.ht) + ')', g: r.netRgz, v: r.vendeurs } }));
    const P = A.palette(), parts = [['Part commissions B2C', r.partRgzB2C], ['Part commissions B2B', r.partRgzB2B], ['Prime partenaire B2C', r.primePartB2C], ['Prime partenaire B2B', r.primePartB2B], ['Prime indexée objectif FTTHtif', r.primeObjectif]].filter((x) => x[1] > 0);
    A.graphe('fd-ch-donut', { type: 'doughnut', data: { labels: parts.map((x) => x[0]), datasets: [{ data: parts.map((x) => x[1]), backgroundColor: P, borderWidth: 2, borderColor: A.jeton('--surface') }] },
      options: { cutout: '62%', interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (x) => ' ' + x.label + ' : ' + CT.fmt.fcfa(x.parsed) } } } } });
    const ds = (label, a, b, col) => ({ label, data: [a, b], backgroundColor: col, stack: 's', borderRadius: 4, maxBarThickness: 60 });
    A.graphe('fd-ch-struct', { type: 'bar', data: { labels: ['B2C', 'B2B'], datasets: [ds('One-shot', r.oneShotB2C, r.oneShotB2B, P[0]), ds('Primes vendeurs', r.primesVendB2C, r.primesVendB2B, P[2]), ds('Primes partenaire', r.primePartB2C + r.primeObjectif, r.primePartB2B, P[1])] },
      options: { plugins: { tooltip: { callbacks: { label: (x) => ' ' + x.dataset.label + ' : ' + CT.fmt.fcfa(x.parsed.y) } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => CT.fmt.int(v) } } } } });
  }

  async function vueEvo() {
    const root = $('#factevo-content');
    root.innerHTML = '<div class="card empty" aria-busy="true"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><h3>Calcul en cours…</h3></div>';
    let liste; try { liste = await listeMois(); } catch (er) { root.innerHTML = vide2('Lecture impossible : ' + esc(er.message)); return; }
    if (!liste.length) { root.innerHTML = vide2('Importez le fichier « POINT VENTES » du mois dans Facturation › Résumé.'); return; }
    const A = CT.analyse, AC = CT.analyseCalc, pr = CT.etat.prioritaire;
    const lignes = await Promise.all(liste.filter((x) => !S.multi || S.moisSel.includes(x.mois)).map(async (x) => {
      const c = x.mois, L = convertir(await lignesMois(c), c);
      const o = regles(c), r = synthese(L.b2c.length ? F.calculB2C(L.b2c, o) : null, L.b2b.length ? F.calculB2B(L.b2b, o) : null)   /* objectif du mois c */, obj = A.paramsMois(c).t.mois;
      return Object.assign(r, { cle: c, lib: AC.libMois(c), enCours: false, objectif: obj, tro: obj ? r.ventes / obj : null, mixB2B: r.ventes ? r.ventesB2B / r.ventes : null });
    }));
    S.evo = lignes;
    lignes.forEach((x, i) => { const p = lignes[i - 1]; x.evolHT = p && p.ht ? (x.ht - p.ht) / p.ht : null; x.evolV = p && p.ventes ? (x.ventes - p.ventes) / p.ventes : null; });
    const der = lignes[lignes.length - 1], ev = (x) => (x == null ? 'premier mois importé' : (x >= 0 ? '+' : '') + pcx(x, 0) + ' vs mois précédent');
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair((S.multi ? 'Mois de la période ' + esc(libSelection(S.moisSel)) : 'Tous les mois importés (choisissez « 3 derniers mois », « Depuis janvier »… en haut pour restreindre)') + ' — fichiers « POINT VENTES », même règle que les factures : lignes A PAYER + arriérés. Objectif = Paramètres › Objectifs du mois.', 'fa-circle-info')}
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
  function agentsFactures(c2c, c2b) {
    if (arguments.length === 0) { c2c = S.c2c; c2b = S.c2b; }
    const R = F.REGLES, m = new Map(), get = (g) => { let a = m.get(g.loginKey); if (!a) m.set(g.loginKey, (a = { loginKey: g.loginKey, login: g.login, equipe: g.equipe || '', anonymat: g.anonymat, b2c: 0, b2b: 0, b2bHorsReports: 0, primeB2C: 0, primeB2B: 0, commission: 0 })); return a; };
    (c2c ? c2c.logins : []).forEach((g) => { const a = get(g); a.b2c = g.ventes; a.primeB2C = g.primePerf; a.commission += g.partVendeur; });
    (c2b ? c2b.logins : []).forEach((g) => { const a = get(g); a.b2b = g.ventes; a.b2bHorsReports = g.ventes - g.reports; a.primeB2B = g.primeVTB; a.commission += g.commVTB; });
    return [...m.values()].map((a) => Object.assign(a, { ventes: a.b2c + a.b2b, gain: a.commission + a.primeB2C + a.primeB2B, pC: palier(R.b2c.primeVendeur, a.b2c), pB: palier(R.b2b.primeVendeur, a.b2bHorsReports) })).sort((x, y) => y.gain - x.gain || y.ventes - x.ventes);
  }
  // Cumul de plusieurs mois : pas de colonnes « palier » (un palier se gagne sur un seul mois)
  const colsPerf = (cols) => (S.multi ? cols.filter((c) => c.cle !== 'pC' && c.cle !== 'manque') : cols);
  function vuePerf() {
    const root = $('#factperf-content'), ag = agentsFactures(), A = CT.analyse;
    if (!ag.length) { root.innerHTML = vide2('Aucune vente facturée sur ce mois.'); return; }
    const primes = ag.filter((a) => a.primeB2C + a.primeB2B > 0), R = F.REGLES;
    // Cumul : les paliers se jouent mois par mois → la distribution compte chaque agent dans chacun de ses mois (« agents-mois »)
    const parPalier = (logins) => (seuil) => logins.filter((g) => palier(R.b2c.primeVendeur, g.ventes).seuil === seuil).length;
    const distrib = R.b2c.primeVendeur.map((p) => ({ lib: palier(R.b2c.primeVendeur, p[0]).lib, prime: p[1],
      n: S.multi ? CT.somme(S.parMois, (x) => parPalier(x.c2c ? x.c2c.logins : [])(p[0])) : ag.filter((a) => palier(R.b2c.primeVendeur, a.b2c).seuil === p[0]).length }));
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair(S.multi ? 'Agents payés sur les factures de <b>' + esc(libSelection(S.moisSel)) + '</b> : ventes, commissions et primes additionnées mois par mois (chaque prime de performance est gagnée sur son propre mois).' : 'Agents payés sur les factures ' + esc(deMois(moisFact())) + ' : ventes facturées, commission (80 %, Anonymat 100 %), prime de performance et ventes qui manquent pour le palier suivant.', 'fa-circle-info')}
      <div class="grid-kpi">
        ${A.kpi('fa-users', 'info', 'Agents payés', mn(ag.length), mn(primes.length) + ' avec une prime de performance')}
        ${A.kpi('fa-trophy', 'pos', S.multi ? 'N°1 de la période' : 'N°1 du mois', esc(nomLogin(ag[0].loginKey)), mn(ag[0].ventes) + ' ventes · ' + fc(ag[0].gain))}
        ${A.kpi('fa-medal', 'warn', 'Primes de performance', fc(CT.somme(ag, (a) => a.primeB2C + a.primeB2B)), 'moyenne ' + fc(primes.length ? CT.somme(primes, (a) => a.primeB2C + a.primeB2B) / primes.length : 0) + ' par agent primé')}
        ${S.multi ? A.kpi('fa-layer-group', '', 'Mois cumulés', mn(S.moisSel.length), esc(libSelection(S.moisSel))) : A.kpi('fa-arrow-up-right-dots', '', 'Proches du palier suivant', mn(ag.filter((a) => a.pC.manque > 0 && a.pC.manque <= 3).length), '3 ventes B2C ou moins à faire')}</div>
      <div class="grid-2">
        ${A.carte('fp-top', 'Top 10 agents — gains ' + (S.multi ? 'de la période' : 'du mois'), 'Commission + primes (FCFA)', '<div class="chart-box tall"><canvas id="fp-ch-top" role="img" aria-label="Top agents"></canvas></div>')}
        ${A.carte('fp-pal', 'Distribution par palier de prime B2C', (S.multi ? 'Agents-mois par palier : chaque agent compté dans chacun de ses mois' : 'Nombre d\'agents par palier') + ' (grille ' + R.b2c.primeVendeur.slice(1).map((p) => p[0] + '+ = ' + CT.fmt.int(p[1])).join(' · ') + ')', '<div class="chart-box tall"><canvas id="fp-ch-pal" role="img" aria-label="Distribution par palier"></canvas></div>')}</div>
      ${A.carte('fp-tab', 'Classement complet', 'Trié par gain ' + (S.multi ? 'de la période' : 'du mois'), '<div id="fp-t"></div>')}</div>`;
    $('#fp-t').append(creer({ pageSize: 20, recherche: true, caption: 'Performance agents', lignes: ag.map((a, i) => Object.assign({ rang: i + 1 }, a)), colonnes: colsPerf([{ cle: 'rang', titre: 'N°', num: true }, { cle: 'login', titre: 'Agent', fmt: (v, a) => nomLogin(a.loginKey) + (a.anonymat ? ' (Anonymat)' : '') }, { cle: 'equipe', titre: 'Équipe' },
      { cle: 'b2c', titre: 'B2C', num: true, fmt: mn }, { cle: 'b2b', titre: 'B2B', num: true, fmt: mn }, { cle: 'pC', titre: 'Palier B2C', tri: (a) => a.b2c, fmt: (v) => v.lib }, { cle: 'manque', titre: 'Palier suivant', tri: (a) => a.pC.manque || 999, fmt: (v, a) => (a.pC.manque ? 'encore ' + a.pC.manque + ' vente(s) → ' + CT.fmt.int(a.pC.primeSuivante) : 'palier maximal') },
      { cle: 'commission', titre: 'Commission (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'primeB2C', titre: 'Prime B2C', num: true, fmt: CT.fmt.mnt }, { cle: 'primeB2B', titre: 'Prime B2B', num: true, fmt: CT.fmt.mnt }, { cle: 'gain', titre: 'Total (FCFA)', num: true, html: true, fmt: (v) => '<b>' + CT.fmt.mnt(v) + '</b>' }]),
      pied: { login: 'TOTAL', b2c: CT.somme(ag, (a) => a.b2c), b2b: CT.somme(ag, (a) => a.b2b), commission: CT.somme(ag, (a) => a.commission), primeB2C: CT.somme(ag, (a) => a.primeB2C), primeB2B: CT.somme(ag, (a) => a.primeB2B), gain: CT.somme(ag, (a) => a.gain) } }));
    const P = A.palette(), top = ag.slice(0, 10);
    A.graphe('fp-ch-top', { type: 'bar', data: { labels: top.map((a) => nomLogin(a.loginKey)), datasets: [{ label: 'Commission', data: top.map((a) => a.commission), backgroundColor: P[0], stack: 'g', borderRadius: 4 }, { label: 'Primes', data: top.map((a) => a.primeB2C + a.primeB2B), backgroundColor: P[2], stack: 'g', borderRadius: 4 }] },
      options: { indexAxis: 'y', plugins: { tooltip: { callbacks: { label: (x) => ' ' + x.dataset.label + ' : ' + CT.fmt.fcfa(x.parsed.x) } } }, scales: { x: { stacked: true, beginAtZero: true, ticks: { callback: (v) => CT.fmt.int(v) } }, y: { stacked: true, grid: { display: false } } } } });
    A.graphe('fp-ch-pal', { type: 'bar', data: { labels: distrib.map((x) => x.lib), datasets: [{ label: 'Agents', data: distrib.map((x) => x.n), backgroundColor: distrib.map((x, i) => P[i % P.length]), borderRadius: 4, maxBarThickness: 48 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  }

  function vueReco() {
    const root = $('#factreco-content'), der = S.multi ? S.parMois[S.parMois.length - 1] : null, c = der ? der.c2c : S.c2c, d = der ? der.c2b : S.c2b, A = CT.analyse, R = F.REGLES, pr = CT.etat.prioritaire;
    if (!c && !d) { root.innerHTML = vide2('Aucune vente facturée sur ce mois.'); return; }
    const reco = [], ag = agentsFactures(c, d);
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
    // 4. Prime partenaire indexée au taux d'atteinte de l'objectif FTTH de l'opérateur (B2C) : ventes du mois sans arriérés
    if (c && c.objectif) { const v = c.ventesObjectif, sv = R.b2c.primeObjectif.find((p) => p[0] > v); if (!c.objectifAtteint) reco.push({ ic: 'fa-bullseye', titre: 'Prime indexée objectif FTTH : ' + mn(c.objectif - v) + ' vente(s) du mois manquante(s)', gain: [[0, 0]].concat(R.b2c.primeObjectif).filter((p) => c.objectif >= p[0]).pop()[1], detail: 'Objectif de l\'opérateur : ' + mn(c.objectif) + ' ventes ; ' + mn(v) + ' ventes du mois (sans les arriérés).' }); else if (sv) reco.push({ ic: 'fa-bullseye', titre: 'Prime indexée objectif FTTH : ' + mn(sv[0] - v) + ' vente(s) pour la tranche de ' + CT.fmt.int(sv[1]), gain: sv[1] - c.primeObjectif, detail: 'Objectif atteint ; la tranche suivante commence à ' + mn(sv[0]) + ' ventes du mois.' }); }
    else if (c) reco.push({ ic: 'fa-bullseye', titre: 'Objectif FTTH de l\'opérateur non saisi', gain: 0, detail: 'Saisissez l\'objectif du mois dans Facture B2C : la prime partenaire indexée (200 000 à 500 000 HT) sera ajoutée à la facture s\'il est atteint.' });
    // 5. Mix B2B : une vente B2B rapporte plus qu'une vente B2C
    if (c && d && osB > osC) reco.push({ ic: 'fa-scale-balanced', titre: 'Une vente B2B rapporte ' + CT.fmt.int(osB - osC) + ' FCFA de plus qu\'une vente B2C', gain: 0, detail: 'One-shot moyen : ' + CT.fmt.int(osB) + ' FCFA en B2B contre ' + CT.fmt.int(osC) + ' FCFA en B2C. Orienter les vendeurs vers les entreprises augmente la facture à volume égal.' });
    reco.sort((x, y) => y.gain - x.gain); S.reco = reco;
    const tot = CT.somme(reco, (x) => x.gain);
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair('Leviers d\'amélioration des gains ' + esc(pr) + ' sur les factures ' + esc(deMois(der ? CT.date.libelleMois(der.mois) : moisFact())) + (der ? ' (dernier mois de la période : les paliers se jouent mois par mois)' : '') + ', triés par gain potentiel (montants HT facturables à Celtiis).', 'fa-lightbulb')}
      <div class="grid-kpi">${A.kpi('fa-sack-dollar', 'pos', 'Gain potentiel identifié', fc(tot), reco.filter((x) => x.gain > 0).length + ' levier(s) chiffré(s)')}</div>
      ${A.carte('fr-liste', 'Leviers d\'amélioration', 'Du plus rentable au moins rentable', `<ul class="alerts">${reco.map((x) => `<li class="alert ${x.gain > 0 ? 'pos' : 'info'}"><span class="alert-ic"><i class="fa-solid ${x.ic}" aria-hidden="true"></i></span><div><strong>${esc(x.titre)}${x.gain > 0 ? ' — +' + esc(fc(x.gain)) : ''}</strong><span>${esc(x.detail)}</span></div></li>`).join('') || '<li class="muted">Aucun levier identifié.</li>'}</ul>`)}</div>`;
  }

  const RENDU = { challogin: () => vueChallenge('login'), chalequipe: () => vueChallenge('equipe'), factb2c: vueB2C, factb2b: vueB2B, finance: vueFinance, reports: vueReports, factdash: vueDash, factevo: vueEvo, factperf: vuePerf, factreco: vueReco };
  async function rendre() {
    const v = CT.etat.vue; masquerBarres(); if (!RENDU[v]) return;
    if (v !== 'challogin' && v !== 'chalequipe') { try { await depuisBase(); if (v === 'factdash') await historique(); } catch (er) { console.warn('Facturation : lecture en base impossible', er); } if (CT.etat.vue !== v) return; }
    await RENDU[v](); masquerBarres();
  }
  function masquerBarres() {
    const v = CT.etat.vue, nouvelle = !!VUES[v], challenge = v.indexOf('chal') === 0, avecDonnees = !!CT.etat.lignes.length, facture = nouvelle && !challenge;
    const sb = $('#sharebar'), gf = $('#global-date-filters'), st = $('#filter-status');
    if (sb) sb.hidden = facture ? !(S.c2c || S.c2b) : !avecDonnees;   // la barre d'export sert aussi sur ces pages (module ci-dessous)
    if (st) st.hidden = facture;
    if (gf) gf.hidden = facture || !avecDonnees;   // facture : les dates sont remplacées par la barre « Mois facturé »
    majBarreFacture(facture);
  }
  function evenements(e) {
    const t = e.target;
    if (t.matches && t.matches('input[type=file][data-seg]') && t.files[0]) importer(t.dataset.seg, t.files[0]);
    if (t.id === 'fact-fichier' && t.files.length) { const l = [...t.files]; t.value = ''; importerFactures(l); }
    if (t.id === 'fp-autre' && t.value) choisirMois(t.value);
    if (t.id === 'rp-pas') { S.pas = t.value; rendre(); }
  }
  function clics(e) {
    const b = e.target.closest && e.target.closest('button[id^="xl-"]'); if (!b) return;
    const mois = S.multi ? S.moisSel[0] + '_au_' + S.moisSel[S.moisSel.length - 1] : (S.mois || CT.etat.cle || new Date().toISOString().slice(0, 7));
    try {
      if (b.id === 'xl-b2c') telecharger('Facturation_B2C_' + mois, feuillesB2C());
      else if (b.id === 'xl-b2b' || b.id === 'xl-fb2b') telecharger('Facturation_B2B_' + mois, feuillesB2B());
      else if (b.id === 'xl-fin') telecharger('Point_financier_par_login_' + mois, feuillesFinance());
      else if (b.id === 'xl-rp') telecharger('Reports_' + S.pas, feuillesReports());
      else if (b.id === 'xl-ch' && S.chDef) telecharger(S.chDef.nom.replace(/\s/g, '_'), [S.chDef]);
    } catch (err) { CT.toast('Export impossible : ' + err.message, 'err'); }
  }
  document.addEventListener('submit', (e) => { if (e.target.id === 'fo-obj') { e.preventDefault(); enregistrerObjectif(e.target.dataset.mois, $('#fo-val').value); } });
  document.addEventListener('change', evenements);
  document.addEventListener('click', clics);
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-fmois]'); if (b) { choisirMois(b.dataset.fmois); if (!b.closest('#fp-mois')) window.scrollTo({ top: 0 }); } });

  /* ---------- Barre d'export (Excel, PDF, CSV, WhatsApp, Gmail, Outlook, Copier) : données de chaque page Facturation ---------- */
  function feuillesReports() {
    return [{ nom: 'Reports ' + S.pas, cols: [36, 12, 18, 18], aoa: [[S.pas === 'mois' ? 'Mois' : 'Semaine (du lundi au dimanche)', 'Reportés', 'Payés après report', 'Cumul en attente']]
      .concat(F.reports((S.b2c ? S.b2c.lignes : []).concat(S.b2b ? S.b2b.lignes : []), S.pas).map((r) => [libPeriode(r.periode), r.reportes, r.payes, r.cumulReste])) }];
  }
  function feuillesDash() {
    const r = synthese(S.c2c, S.c2b), pr = CT.etat.prioritaire;
    return [{ nom: 'Résumé factures', cols: [44, 22], total: false, aoa: [['Indicateur', 'Valeur'], ['Période', moisFact()], ['Total à facturer TTC (FCFA)', r.ttc], ['Total HT (FCFA)', r.ht], ['TVA 18 % (FCFA)', r.tva],
        ['Facture B2C HT (FCFA)', r.htB2C], ['Ventes B2C facturées', r.ventesB2C], ['Facture B2B HT (FCFA)', r.htB2B], ['Ventes B2B facturées', r.ventesB2B], ['Ventes reportées (non facturées)', r.reportes],
        ['Net ' + pr + ' (FCFA)', r.netRgz], ['Reversé aux vendeurs (FCFA)', r.vendeurs]] },
      { nom: 'Rémunération nette', cols: [50, 18, 18], total: false, aoa: [['Rubrique', 'Net ' + pr + ' (FCFA)', 'Vendeurs (FCFA)'], ['Part ' + pr + ' des commissions B2C', r.partRgzB2C, ''], ['Part ' + pr + ' des commissions B2B', r.partRgzB2B, ''],
        ['Prime de performance partenaire B2C', r.primePartB2C, ''], ['Prime partenaire B2B', r.primePartB2B, ''], ['Prime partenaire indexée (objectif FTTH de l\'opérateur)', r.primeObjectif, ''], ['Reversé aux vendeurs B2C', '', r.vendeursB2C], ['Reversé aux vendeurs B2B', '', r.vendeursB2B],
        ['TOTAL (= facture HT ' + CT.fmt.int(r.ht) + ')', r.netRgz, r.vendeurs]] }]
      .concat(S.multi ? [{ nom: 'Factures par mois', cols: [20, 12, 12, 12, 18, 18, 18, 18], aoa: [['Mois', 'Ventes B2C', 'Ventes B2B', 'Reportées', 'Facture HT (FCFA)', 'TTC (FCFA)', 'Vendeurs (FCFA)', 'Net ' + pr + ' (FCFA)']]
          .concat(S.parMois.map((x) => { const y = synthese(x.c2c, x.c2b); return [CT.date.libelleMois(x.mois), y.ventesB2C, y.ventesB2B, y.reportes, y.ht, y.ttc, y.vendeurs, y.netRgz]; })) }] : [],
        S.c2c ? feuillesB2C().slice(0, 1) : [], S.c2b ? feuillesB2B().slice(0, 1) : []);
  }
  function feuillesEvo() {
    const L = S.evo || [], s = (k) => CT.somme(L, (x) => x[k] || 0);
    return [{ nom: 'Évolution facturation', cols: [18, 12, 12, 12, 14, 18, 18, 18, 18, 18], total: false, aoa: [['Mois', 'Ventes B2C', 'Ventes B2B', 'Reportées', 'Mix B2B (taux)', 'Taux d\'atteinte objectif', 'Facture HT (FCFA)', 'TTC (FCFA)', 'Vendeurs (FCFA)', 'Net ' + CT.etat.prioritaire + ' (FCFA)']]
      .concat(L.map((x) => [x.lib + (x.enCours ? ' (en cours)' : ''), x.ventesB2C, x.ventesB2B, x.reportes, x.mixB2B == null ? '' : x.mixB2B, x.tro == null ? '' : x.tro, x.ht, x.ttc, x.vendeurs, x.netRgz]),
        [['TOTAL', s('ventesB2C'), s('ventesB2B'), s('reportes'), '', '', s('ht'), s('ttc'), s('vendeurs'), s('netRgz')]]) }];
  }
  function feuillesPerf() {
    const ag = agentsFactures(), R = F.REGLES, s = (k) => CT.somme(ag, (a) => a[k] || 0);
    const f = feuillesPerfMois(ag, R, s);
    if (S.multi) { f[0].aoa = f[0].aoa.map((r) => r.filter((v, i) => i !== 5 && i !== 6)); f[0].cols = f[0].cols.filter((v, i) => i !== 5 && i !== 6); f[0].nom = 'Performance agents (cumul)'; return f.slice(0, 1); }
    return f;
  }
  function feuillesPerfMois(ag, R, s) {
    return [{ nom: 'Performance agents', cols: [6, 26, 16, 8, 8, 18, 30, 16, 14, 14, 16], total: false, aoa: [['N°', 'Agent', 'Équipe', 'B2C', 'B2B', 'Palier B2C', 'Palier suivant', 'Commission (FCFA)', 'Prime B2C (FCFA)', 'Prime B2B (FCFA)', 'Total (FCFA)']]
        .concat(ag.map((a, i) => [i + 1, a.login + (a.anonymat ? ' (Anonymat)' : ''), a.equipe, a.b2c, a.b2b, a.pC.lib, a.pC.manque ? 'encore ' + a.pC.manque + ' vente(s) → ' + CT.fmt.int(a.pC.primeSuivante) : 'palier maximal', a.commission, a.primeB2C, a.primeB2B, a.gain]),
          [['TOTAL', '', '', s('b2c'), s('b2b'), '', '', s('commission'), s('primeB2C'), s('primeB2B'), s('gain')]]) },
      { nom: 'Paliers de prime B2C', cols: [26, 18, 10], total: false, aoa: [['Palier', 'Prime (FCFA)', 'Agents']].concat(R.b2c.primeVendeur.map((p) => [palier(R.b2c.primeVendeur, p[0]).lib, p[1], ag.filter((a) => palier(R.b2c.primeVendeur, a.b2c).seuil === p[0]).length]), [['TOTAL', '', ag.length]]) }];
  }
  function feuillesReco() {
    const L = S.reco || [];
    return [{ nom: 'Recommandations', cols: [70, 22, 110], total: false, aoa: [['Levier', 'Gain potentiel HT (FCFA)', 'Détail']].concat(L.map((x) => [x.titre, x.gain || 0, x.detail]), [['TOTAL', CT.somme(L, (x) => x.gain || 0), '']]) }];
  }
  const MODULES = { factdash: ['Résumé de la facturation', feuillesDash], factb2b: ['Facture B2B', feuillesB2B], factb2c: ['Facture B2C', feuillesB2C], factevo: ['Évolution de la facturation', feuillesEvo],
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
