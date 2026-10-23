/* ============================================================================
   app.js — orchestration : thème, navigation, import (upload → analyse → contrôle qualité),
   recalcul global, branchement de la barre de partage.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const { h, $, $$ } = CT;
  const etat = (CT.etat = { res: null, lignes: [], meta: null, qualite: null, jourRef: null, cle: null, vue: 'dashboard', prioritaire: 'RGZ', motiv: null, motivPJ: null, motivPerf: null, perf: null, filtre: null, kpiFiltre: null, jourDu: null, periodeDu: null, noteDates: '' });
  let fichierChoisi = null, analyseEnCours = false, appliquerDates = async () => {};
  const VUES = { dashboard: { id: 'view-dashboard', titre: 'Tableau de bord' }, rgz: { id: 'view-rgz', titre: 'Tableau de bord RGZ' }, pointjour: { id: 'view-pointjour', titre: 'Point du jour' }, perf: { id: 'view-perf', titre: 'Performance partenaires' } };
  const HASH = { '#dashboard': 'dashboard', '#rgz': 'rgz', '#point-du-jour': 'pointjour', '#performance': 'perf' };

  /* ---------- Thème (auto / clair / sombre) ---------- */
  const THEMES = ['auto', 'light', 'dark'], LIB = { auto: 'Automatique', light: 'Clair', dark: 'Sombre' }, ICO = { auto: 'fa-circle-half-stroke', light: 'fa-sun', dark: 'fa-moon' };
  function themeInit() {
    appliquerTheme('auto');
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    mq && mq.addEventListener && mq.addEventListener('change', rafraichirGraphiques);
  }
  function appliquerTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    const b = $('#theme-btn'); if (b) { b.innerHTML = `<i class="fa-solid ${ICO[t]}" aria-hidden="true"></i><span class="sr-only">Thème : ${LIB[t]}</span>`; b.title = 'Thème : ' + LIB[t] + ' (cliquer pour changer)'; }
  }
  function rafraichirGraphiques() { setTimeout(() => { CT.dashboard.refreshTheme(); CT.rgz.refreshTheme(); CT.perf.refreshTheme(); }, 60); }

  /* ---------- Navigation ---------- */
  function vue(nom) {
    if (!VUES[nom]) nom = 'dashboard';
    etat.vue = nom;
    Object.entries(VUES).forEach(([k, v]) => { const el = document.getElementById(v.id); el.classList.toggle('active', k === nom); });
    $$('#nav a[data-vue]').forEach((a) => { if (a.dataset.vue === nom) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = VUES[nom].titre + ' — POWERGZ';
    const ctx = $('#share-ctx'); if (ctx) ctx.textContent = VUES[nom].titre;
    window.scrollTo({ top: 0 });
  }

  /* ---------- Calculs globaux ---------- */
  /* Période choisie dans les filtres de date de la barre du haut :
       • « Date de fin »  = jour de référence (vide → dernier jour en base) ; le mois de calcul est celui de cette date ;
       • « Date de début » (facultative) = début de la période, dans n'importe quel mois.
     Tableau de bord (KPI, graphiques, tops, détail) : toute la période début → fin, même sur plusieurs mois.
     Objectifs, Point du jour et Performance sont mensuels : leur période commence au plus tôt le 1er du mois de la date de fin.
     Sans date de début : Point du jour = la journée de référence ; Performance = du 1er du mois à la date de fin (comportement historique). */
  const debutMoisDe = (j) => j.slice(0, 7) + '-01';
  function normaliserPeriode() {
    const q = etat.qualite; etat.noteDates = '';
    const debut = $('#global-date-debut'), fin = $('#global-date-fin');
    let d = debut && debut.value ? debut.value : '', f = fin && fin.value ? fin.value : '';
    if (d && f && d > f) { const t = d; d = f; f = t; etat.noteDates = 'Dates inversées : la période a été remise dans l\'ordre.'; }
    const maxi = etat.bornes && etat.bornes.au > q.au ? etat.bornes.au : q.au;   // dernière date en base (les lignes chargées vont jusqu'à la date de fin)
    if (f) f = f < q.du ? q.du : f > maxi ? maxi : f;
    etat.jourRef = f || q.au;
    if (d > etat.jourRef) d = etat.jourRef;
    etat.dashDu = d || null;                                  // tableau de bord : la période telle que saisie
    // Période sur plusieurs mois : chaque mois est calculé avec ses objectifs, puis les résultats sont additionnés (classerEtCalculer)
    if (d && d < debutMoisDe(etat.jourRef)) etat.noteDates = 'Période sur plusieurs mois : chaque mois est calculé avec ses propres objectifs, puis les résultats sont additionnés.';
    etat.jourDu = d && d < etat.jourRef ? d : null;           // une seule journée → pas de « plage »
    etat.periodeDu = d || null;
    if (debut && debut.value !== d) debut.value = d;
    if (fin && fin.value && fin.value !== f) fin.value = f;
  }
  /* Lignes à charger depuis la base pour les dates saisies : [début (ou 1er du mois de fin) → fin].
     Toujours depuis le 1er du mois de fin : le cumul mensuel (objectifs, rythme) en a besoin. */
  function plageRequise() {
    const b = etat.bornes || {}, p = etat.periodeDefaut || {};
    const debut = $('#global-date-debut'), fin = $('#global-date-fin');
    let d = debut && debut.value ? debut.value : '', f = fin && fin.value ? fin.value : '';
    if (d && f && d > f) { const t = d; d = f; f = t; }
    f = f || p.au || b.au; if (!f) return null;
    if (b.au && f > b.au) f = b.au;
    if (b.du && f < b.du) f = b.du;
    const dm = debutMoisDe(f);
    return { du: d && d < dm ? d : dm, au: f };
  }
  function classerEtCalculer(sansClasser) {
    if (!etat.res) return;
    normaliserPeriode();
    const cfg = CT.store.get().partenaires;
    etat.prioritaire = cfg.prioritaire || 'RGZ';
    etat.cle = etat.jourRef.slice(0, 7);
    const P = CT.store.actifs(etat.cle);
    if (!sansClasser) CT.parser.classer(etat.lignes, P.regles, cfg);
    const base = { cle: etat.cle, jourRef: etat.jourRef, prioritaire: etat.prioritaire }, du = etat.jourDu, duPerf = etat.periodeDu;
    // Tableau de bord : toujours « mois à date » + journée de référence
    etat.motiv = CT.calc.motivation(etat.lignes, base);
    // Point du jour : cumul du mois (inchangé) + ventes/objectif/primes de la période [début → fin]
    etat.motivPJ = du ? CT.calc.motivation(etat.lignes, Object.assign({ jourDu: du }, base)) : etat.motiv;
    // Performance : tout est calculé sur la période [début → fin] (début = fin → cette seule journée)
    etat.motivPerf = duPerf ? CT.calc.motivation(etat.lignes, Object.assign({ du: duPerf }, base)) : etat.motiv;
    etat.perf = CT.calc.perfPartenaires(etat.lignes, Object.assign({ cfg, du: duPerf }, base));
    // Performance par login (One-Shot, commissions, taux de réalisation par équipe) : équipes et objectifs lus dans les paramètres
    etat.perfLogin = CT.calc.performanceLogins(etat.lignes, { cle: etat.cle, jourRef: etat.jourRef, partenaire: etat.prioritaire, motiv: etat.motivPerf, du: duPerf });
    // Commissions, primes et coût du plan de la période [début → fin] : UNE seule règle, reprise par toutes les pages
    // (Point du jour, Tableau de bord RGZ, Performance) pour afficher les mêmes montants partout.
    //  • période qui commence le 1er du mois : plan complet à date (journées, champion, paliers, bonus B2B, fin de mois) ;
    //  • période partielle : seulement les primes gagnées jour par jour pendant la période. Les primes mensuelles (paliers de
    //    TRO, bonus B2B, fin de mois) ne s'acquièrent que sur le mois : les compter sur quelques jours les gonflait
    //    (ex. 108 500 FCFA sur 5 jours contre 69 100 FCFA sur le mois entier).
    const duP = CT.periode.perfDu(), partielle = duP > etat.cle + '-01';
    if (duP < etat.cle + '-01') { calculerPlusieursMois(cfg, duP); return; }
    const cp = CT.calc.commissionsPrimes(etat.lignes, { cle: etat.cle, du: duP, au: etat.jourRef, partenaire: etat.prioritaire, motiv: partielle ? etat.motivPJ : etat.motiv, mode: partielle ? 'periode' : 'cumul' });
    if (partielle) {   // projection des commissions : rythme des jours ouvrés de la période prolongé sur le mois
      const oP = etat.motivPJ.estPlage ? etat.motivPJ.ouvresPeriode : (etat.motivPJ.ouvre ? 1 : 0);
      cp.total.projection = oP > 0 ? (cp.total.commissions / oP) * etat.motiv.nbOuvres : null;
    }
    etat.primesPeriode = cp;
    // Coût du plan / marge de la période, même détail poste par poste que le budget du mois (primes mensuelles à 0 si partielle)
    etat.budgetPeriode = partielle ? budgetPartiel(etat.motivPJ, etat.motivPerf.budget.marge) : etat.motiv.budget;
  }
  /* Coût du plan d'une période partielle : seulement les primes gagnées jour par jour (primes mensuelles à 0) */
  function budgetPartiel(mj, marge) {
    const coutAg = { journees: CT.somme(mj.agents, (a) => a.primeJour), champion: CT.somme(mj.agents, (a) => a.primeChampion), paliers: 0, bonusB2B: 0 };
    const coutSup = { journees: CT.somme(mj.equipes, (q) => q.primeSupJour), finMois: 0, trophee: 0 };
    const cout = CT.somme(Object.values(coutAg)) + CT.somme(Object.values(coutSup));
    return { coutAg, coutSup, cout, marge, ratio: marge > 0 ? cout / marge : null, partielle: true };
  }
  /* Période sur plusieurs mois (début avant le 1er du mois de fin) : chaque mois est calculé à part avec SES objectifs et
     SES règles, sur sa partie de la période, puis tout est additionné. Un mois couvert depuis le 1er garde le plan complet
     (paliers, bonus B2B, fin de mois) ; un mois couvert en partie (le premier) ne compte que les primes gagnées jour par jour. */
  function calculerPlusieursMois(cfg, du) {
    const C = CT.calc, pr = etat.prioritaire;
    // Mois sans aucune vente en base (avant la mise en service, par exemple) : ignorés, sinon leurs objectifs creuseraient un faux retard
    const tr = C.tranches(du, etat.jourRef).filter((t, i, all) => i === all.length - 1 || etat.lignes.some((l) => l.jour && l.jour >= t.du && l.jour <= t.au));
    if (tr[0].du > du) etat.noteDates = 'Aucune donnée en base avant le ' + CT.date.court(tr[0].du) + ' : les objectifs ne comptent qu\'à partir de cette date.'
      + (tr.length > 1 ? ' Chaque mois est calculé avec ses propres objectifs, puis les résultats sont additionnés.' : '');
    const segs = tr.map((t) => C.motivation(etat.lignes, { cle: t.cle, jourRef: t.au, prioritaire: pr, du: t.du, jourDu: t.du }));
    etat.motivPJ = etat.motivPerf = C.combinerMotivations(segs);
    etat.perf = C.combinerPerfPartenaires(tr.map((t) => C.perfPartenaires(etat.lignes, { cle: t.cle, jourRef: t.au, prioritaire: pr, cfg, du: t.du })));
    etat.perfLogin = C.combinerPerfLogins(tr.map((t, i) => C.performanceLogins(etat.lignes, { cle: t.cle, jourRef: t.au, partenaire: pr, motiv: segs[i], du: t.du })));
    const partiel = (t) => t.du > t.cle + '-01';
    const cps = tr.map((t, i) => {
      const cp = C.commissionsPrimes(etat.lignes, { cle: t.cle, du: t.du, au: t.au, partenaire: pr, motiv: segs[i], mode: partiel(t) ? 'periode' : 'cumul' });
      if (partiel(t)) cp.total.projection = cp.total.commissions;   // mois de début : seulement ce qui a été vendu pendant la période
      return cp;
    });
    etat.primesPeriode = C.combinerPrimes(cps, etat.motivPerf);
    const budgets = tr.map((t, i) => (partiel(t) ? budgetPartiel(segs[i], segs[i].budget.marge) : segs[i].budget));
    const coutAg = {}, coutSup = {};
    budgets.forEach((b) => { Object.keys(b.coutAg).forEach((k) => { coutAg[k] = (coutAg[k] || 0) + b.coutAg[k]; }); Object.keys(b.coutSup).forEach((k) => { coutSup[k] = (coutSup[k] || 0) + b.coutSup[k]; }); });
    const cout = CT.somme(budgets, (b) => b.cout), marge = CT.somme(budgets, (b) => b.marge);
    etat.budgetPeriode = { coutAg, coutSup, cout, marge, ratio: marge > 0 ? cout / marge : null, partielle: budgets.some((b) => b.partielle) };
  }
  /* Texte de la période (titres, exports) */
  CT.periode = {
    plage: () => !!etat.jourDu,
    texte: () => (etat.jourDu ? 'du ' + CT.date.court(etat.jourDu) + ' au ' + CT.date.court(etat.jourRef) : CT.date.long(etat.jourRef)),
    // Performance : période propre à la page (début → fin ; sans début : du 1er du mois à la fin)
    perfDu: () => etat.periodeDu || etat.cle + '-01',
    perfPartielle: () => !!etat.periodeDu && etat.periodeDu !== etat.cle + '-01',
    plusieursMois: () => !!etat.periodeDu && etat.periodeDu < etat.cle + '-01',
    perf: () => (etat.periodeDu === etat.jourRef ? CT.date.court(etat.jourRef) : 'du ' + CT.date.court(etat.periodeDu || etat.cle + '-01') + ' au ' + CT.date.court(etat.jourRef)),
    fichier: () => (etat.jourDu ? etat.jourDu + '_au_' + etat.jourRef : etat.jourRef),
    fichierPerf: () => (CT.periode.perfPartielle() ? (etat.periodeDu === etat.jourRef ? etat.jourRef : etat.periodeDu + '_au_' + etat.jourRef) : etat.cle),
    /* Semaine de la période : du lundi (ou de la date de début si elle est plus tardive) à la date de fin, partenaire prioritaire.
       Objectif : celui de la semaine (fichier) si tous ses jours ouvrés sont couverts, sinon objectif du jour × jours ouvrés
       couverts — une semaine commencée n'est pas comparée à l'objectif de la semaine entière. */
    semaine: () => {
      const m = etat.motiv, lundi = CT.date.lundiDe(etat.jourRef), du = CT.periode.perfDu() > lundi ? CT.periode.perfDu() : lundi;
      const comptes = m.regles.statuts_comptes || ['OK'];
      const ventes = etat.lignes.filter((l) => l.partenaire === etat.prioritaire && comptes.includes(l.statut) && l.jour && l.jour >= du && l.jour <= etat.jourRef).length;
      const ouvresEntre = (a, b) => CT.date.joursDuMois(etat.cle).filter((j) => j >= a && j <= b && CT.objectifs.estOuvre(m.objectifs, j)).length;
      const couverts = ouvresEntre(du, etat.jourRef), entiere = du === lundi && couverts > 0 && couverts === ouvresEntre(lundi, CT.date.ajouter(lundi, 6));
      return { du, ventes, entiere, objectif: entiere ? m.reseau.objSemaine : Math.round(m.reseau.objJour * couverts) };
    },
    /* Objectif de la période [début → fin] (objectif du jour × jours ouvrés écoulés de la période) et réalisé du partenaire prioritaire */
    objectif: () => { const r = etat.motivPerf.reseau; return { real: r.real, objectif: r.objADate, taux: r.objADate > 0 ? r.real / r.objADate : null }; },
  };

  function rendreTout() {
    const a = !!etat.lignes.length;
    $$('.view-loading').forEach((el) => { el.hidden = true; });   // premier rendu : le chargement initial est terminé
    $('#pj-empty').hidden = a; $('#perf-empty').hidden = a; $('#rgz-empty').hidden = a; $('#pj-content').hidden = !a; $('#perf-content').hidden = !a; $('#rgz-content').hidden = !a;
    $$('#sharebar [data-action]').forEach((b) => { b.disabled = !a; });
    const sel = $('#pj-format'); if (sel) sel.disabled = !a;
    const globalFilters = $('#global-date-filters');
    if (globalFilters) globalFilters.hidden = !a;
    if (a) {
      const debutInput = $('#global-date-debut');
      const finInput = $('#global-date-fin');
      if (debutInput) { debutInput.min = (etat.bornes || etat.qualite).du; debutInput.max = (etat.bornes || etat.qualite).au; }
      if (finInput) { finInput.min = (etat.bornes || etat.qualite).du; finInput.max = (etat.bornes || etat.qualite).au; }
      const dDu = etat.dashDu || debutMoisDe(etat.jourRef), dashN = etat.lignes.filter((l) => l.jour && l.jour >= dDu && l.jour <= etat.jourRef).length;
      $('#dash-sub').textContent = etat.meta.nom + ' — du ' + CT.date.court(dDu) + ' au ' + CT.date.court(etat.jourRef) + ' · ' + CT.fmt.int(dashN) + ' souscriptions';
      $('#pj-sub').textContent = (etat.jourDu ? 'Période ' + CT.periode.texte() : CT.date.long(etat.jourRef)) + ' — périmètre ' + etat.prioritaire;
      $('#perf-sub').textContent = CT.date.libelleMois(etat.cle) + (CT.periode.perfPartielle() ? ' · période ' + CT.periode.perf() : ' · du 1er au ' + CT.date.court(etat.jourRef)) + ' — tous partenaires, ' + etat.prioritaire + ' mis en avant';
      const st = $('#filter-status');
      if (st) {
        const nO = etat.motivPJ.ouvresPeriode, nj = etat.motivPJ.nbJoursPeriode;
        const filtre = etat.periodeDu && !etat.jourDu ? 'Journée <b>' + CT.date.court(etat.jourRef) + '</b> · Point du jour et Performance ne comptent que les ventes de ce jour.'
          : etat.jourDu ? 'Période <b>' + CT.periode.texte() + '</b> · ' + nj + ' jour' + (nj > 1 ? 's' : '') + ' dont ' + nO + ' ouvré' + (nO > 1 ? 's' : '') + ' · Point du jour et Performance ne comptent que les ventes de cette période.'
          : 'Journée de référence : <b>' + CT.date.court(etat.jourRef) + '</b> (Point du jour) · Performance : du 1er au ' + CT.date.court(etat.jourRef) + '. Renseignez une date de début pour analyser une période.';
        st.innerHTML = filtre + (etat.noteDates ? ' <span class="badge badge-warn">' + CT.esc(etat.noteDates) + '</span>' : '');
      }
    } else {
      $('#dash-sub').textContent = "Importez le fichier « NouvellesSouscriptionOffre » pour calculer vos indicateurs.";
    }
    CT.dashboard.render(); CT.rgz.render(); CT.pointJour.render(); CT.perf.render(); rendreImport();
  }

  /* Pré-remplit « Date de début / Date de fin » avec la période du dernier fichier importé. Faux si aucune n'est connue. */
  function datesParDefaut() {
    const p = etat.periodeDefaut, d = $('#global-date-debut'), f = $('#global-date-fin');
    if (!p || !p.au || !d || !f) return false;
    d.value = p.du || ''; f.value = p.au;
    return true;
  }
  function viderFiltresDates() { ['#global-date-debut', '#global-date-fin', '#f-du', '#f-au'].forEach((id) => { const i = $(id); if (i) i.value = ''; }); etat.jourDu = null; }

  /* ---------- Import ---------- */
  const fileInput = h('input', { type: 'file', id: 'file-input', accept: '.xls,.xlsx,.csv', class: 'sr-only', tabindex: '-1', 'aria-label': 'Choisir un fichier Excel ou CSV' });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) choisir(fileInput.files[0]); fileInput.value = ''; });

  /* Le contenu doit correspondre à l'extension (même contrôle que la règle serveur TableurValide) :
     un PDF ou une image renommés en .xlsx sont refusés tout de suite, avec un message clair. */
  async function contenuConforme(f) {
    const o = new Uint8Array(await f.slice(0, 512).arrayBuffer());
    const ext = (/\.([a-z]+)$/i.exec(f.name) || [])[1].toLowerCase();
    if (ext === 'xlsx') return o[0] === 0x50 && o[1] === 0x4B && o[2] === 0x03 && o[3] === 0x04;
    if (ext === 'xls') return [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1].every((b, i) => o[i] === b);
    return o.length > 0 && !o.some((b) => b <= 0x08 || (b >= 0x0E && b <= 0x1F));
  }
  async function choisir(f) {
    if (!/\.(xls|xlsx|csv)$/i.test(f.name)) { alerteFormat(f.name, 'Seuls les fichiers .xlsx, .xls et .csv sont acceptés.'); return; }
    if (!(await contenuConforme(f))) { alerteFormat(f.name, 'Le contenu ne correspond pas à son extension (fichier renommé, corrompu ou exporté dans un autre format). Réenregistrez-le depuis Excel au format .xlsx, .xls ou .csv.'); return; }
    fichierChoisi = f; rendreImport();
    $('#btn-analyser') && $('#btn-analyser').focus();
  }
  function alerteFormat(nom, detail) {
    CT.modal({ titre: 'Fichier refusé', corps: '<div class="alert neg"><span class="alert-ic">' + CT.icone('critique') + '</span><div><strong>' + CT.esc(nom) + '</strong><span>' + CT.esc(detail) + '</span></div></div>', actions: [{ label: 'Choisir un autre fichier', valeur: true, variante: 'primary' }] })
      .then((v) => { if (v) fileInput.click(); });
  }
  function infoFichier(f) {
    const dn = CT.parser.dateDuNom(f.name);
    return CT.fmt.octets(f.size) + ' · modifié le ' + new Date(f.lastModified).toLocaleDateString('fr-FR') + (dn ? ' · date dans le nom : ' + dn.jour + '/' + String(dn.mois).padStart(2, '0') : '');
  }
  function rendreImport() {
    const zone = $('#import-zone'); if (!zone) return;
    const aDonnees = !!etat.lignes.length;
    // Un fichier est déjà présent (en base ou sélectionné) : le bouton propose explicitement d'en ajouter un nouveau
    const ajout = aDonnees || !!fichierChoisi;
    const btnImport = h('button', { class: 'btn ' + (fichierChoisi ? 'btn-secondary' : 'btn-primary'), type: 'button', id: 'btn-import', onclick: () => fileInput.click() },
      h('i', { class: 'fa-solid ' + (ajout ? 'fa-file-circle-plus' : 'fa-file-import'), 'aria-hidden': 'true' }), ajout ? 'Ajouter un nouveau fichier' : 'Importer les données');
    const prog = h('div', { class: 'analyse-box', id: 'analyse-box', hidden: true },
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', id: 'prog' }, h('span', { id: 'prog-bar', style: 'width:0%' })),
      h('div', { class: 'mini-cap', id: 'prog-msg', 'aria-live': 'polite' }, ''));
    let carte;
    if (aDonnees && !fichierChoisi) {
      carte = h('section', { class: 'card flat', 'aria-label': 'Fichier importé' },
        h('div', { class: 'file-chip' },
          h('div', {}, h('div', { class: 'kpi-label' }, 'Fichier analysé'), h('strong', {}, etat.meta.nom), h('div', { class: 'kpi-sub' }, (etat.meta.taille ? CT.fmt.octets(etat.meta.taille) + ' · ' : '') + CT.fmt.int(etat.lignes.length) + ' lignes · du ' + CT.date.court(etat.qualite.du) + ' au ' + CT.date.court(etat.qualite.au) + ' · Sauvegardé avec succès en base de données MySQL • Zéro stockage local sur le navigateur.')),
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, btnImport)), prog);
    } else {
      const dz = h('div', { class: 'dropzone', id: 'dropzone' },
        h('div', { class: 'big-icon', 'aria-hidden': 'true' }, h('i', { class: 'fa-solid fa-cloud-arrow-up' })),
        h('h2', {}, fichierChoisi ? 'Fichier prêt à analyser' : 'Déposez votre fichier de souscriptions'),
        h('p', {}, fichierChoisi ? 'Cliquez sur « Analyser » pour lancer le contrôle qualité puis le calcul.' : 'Glissez-déposez « NouvellesSouscriptionOffre [JJ Mois].xls » ici, ou utilisez le bouton. Formats acceptés : .xlsx, .xls, .csv — toutes les feuilles de données du classeur sont importées et enregistrées en base.'),
        fichierChoisi ? h('div', { class: 'file-chip', style: 'max-width:560px;margin:0 auto 16px' }, h('div', {}, h('strong', {}, fichierChoisi.name), h('div', { class: 'kpi-sub' }, infoFichier(fichierChoisi)))) : null,
        h('div', { style: 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap' }, btnImport,
          fichierChoisi ? h('button', { class: 'btn btn-primary', type: 'button', id: 'btn-analyser', onclick: analyser }, h('i', { class: 'fa-solid fa-wand-magic-sparkles', 'aria-hidden': 'true' }), 'Analyser') : null),
        prog);
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
      dz.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) choisir(f); });
      carte = dz;
    }
    zone.replaceChildren(carte, fileInput);
  }
  function progres(p, msg) {
    const b = $('#prog-bar'), box = $('#analyse-box'); if (!b) return;
    box.hidden = false; b.style.width = p + '%'; $('#prog').setAttribute('aria-valuenow', Math.round(p)); $('#prog-msg').textContent = msg || '';
  }

  async function analyser() {
    if (!fichierChoisi || analyseEnCours) return;
    analyseEnCours = true; const t0 = performance.now(); const bouton = $('#btn-analyser'); bouton && (bouton.disabled = true);
    try {
      progres(2, 'Démarrage…');
      const res = await CT.parser.lireFichier(fichierChoisi, progres);
      const jours = res.lignes.filter((l) => l.jour).map((l) => l.jour).sort();
      const au = jours[jours.length - 1] || new Date().toISOString().slice(0, 10);
      const cfg = CT.store.get().partenaires, P = CT.store.actifs(au.slice(0, 7));
      CT.parser.classer(res.lignes, P.regles, cfg);
      const qc = CT.parser.controleQualite(res, P.regles);
      progres(100, 'Analyse terminée en ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s');
      const choix = await rapportQualite(res, qc);
      if (choix !== 'continuer') { CT.toast('Import annulé.', 'info', 3000); progres(0, ''); return; }
      etat.res = res; etat.lignes = res.lignes; etat.meta = res.meta; etat.qualite = qc; etat.jourRef = qc.au; etat.charge = { du: qc.du, au: qc.au };
      const fichierEnvoye = fichierChoisi; fichierChoisi = null;
      viderFiltresDates();
      classerEtCalculer(); rendreTout();
      // Envoi à MySQL (upsert, doublons ignorés) puis relecture de la base : l'affichage reflète l'historique cumulé du mois
      if (!(await sauvegarderDonnees(fichierEnvoye))) return;   // échec : alerte affichée, écran remis sur les données de la base
      if (datesParDefaut()) await appliquerDates();               // le fichier qui vient d'être importé devient la période affichée
      else { classerEtCalculer(); rendreTout(); }
      CT.toast(CT.fmt.int(res.lignes.length) + ' lignes calculées et enregistrées en ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s.', 'ok');
      location.hash = '#dashboard'; vue('dashboard');
    } catch (err) { console.error(err); CT.toast(err.message || 'Analyse impossible.', 'err', 9000); progres(0, ''); }
    finally { analyseEnCours = false; const b = $('#btn-analyser'); b && (b.disabled = false); }
  }

  function rapportQualite(res, qc) {
    const ic = { ok: 'fa-check', warn: 'fa-exclamation', err: 'fa-xmark', info: 'fa-info' };
    const items = qc.items.map((i) => `<li class="qc-item ${i.niveau === 'info' ? 'ok' : i.niveau}"><span class="qc-ic" aria-hidden="true"><i class="fa-solid ${ic[i.niveau]}"></i></span><div><strong>${CT.esc(i.label)} : ${CT.fmt.int(i.count)}</strong>${i.detail ? `<small>${CT.esc(i.detail)}</small>` : ''}</div></li>`);
    const dn = res.meta.dateNom; let noteDate = '';
    if (qc.au) {
      const d = +qc.au.slice(8), mo = +qc.au.slice(5, 7);
      if (dn && (dn.jour !== d || dn.mois !== mo)) noteDate = `<li class="qc-item warn"><span class="qc-ic" aria-hidden="true"><i class="fa-solid fa-exclamation"></i></span><div><strong>Date du nom de fichier ≠ dernière date des données</strong><small>Nom : ${dn.jour}/${String(dn.mois).padStart(2, '0')} — données jusqu'au ${CT.date.court(qc.au)}.</small></div></li>`;
      else if (dn) noteDate = `<li class="qc-item ok"><span class="qc-ic" aria-hidden="true"><i class="fa-solid fa-check"></i></span><div><strong>Date du fichier détectée : ${dn.jour}/${String(dn.mois).padStart(2, '0')}</strong><small>Cohérente avec les données.</small></div></li>`;
      if (qc.du !== qc.au) noteDate += `<li class="qc-item ok"><span class="qc-ic" aria-hidden="true"><i class="fa-solid fa-calendar"></i></span><div><strong>Fichier cumulé : du ${CT.date.court(qc.du)} au ${CT.date.court(qc.au)}</strong><small>Le Point du jour utilisera le dernier jour (modifiable ensuite).</small></div></li>`;
    }
    const corps = `<p class="muted" style="margin-bottom:12px">${CT.esc(res.meta.nom)} · feuille « ${CT.esc(res.feuille)} » · ${CT.fmt.int(res.lignes.length)} lignes exploitables.</p><ul class="qc-list">${noteDate}${items.join('')}</ul>`;
    return CT.modal({ titre: 'Contrôle qualité avant calcul', corps,
      actions: qc.bloquant ? [{ label: 'Annuler', valeur: 'annuler', variante: 'primary' }] : [{ label: 'Annuler', valeur: 'annuler' }, { label: 'Continuer le calcul', valeur: 'continuer', variante: 'primary' }] });
  }

  /* ---------- Persistance serveur (MySQL via l'API Laravel) ----------
     Les souscriptions sont envoyées à l'API (upsert sur date + client + MSISDN → aucun doublon),
     puis l'application relit la base au format « tableau Excel » et réutilise SON parseur habituel (CT.parser.depuisAoa) :
     aucun calcul, tableau ni graphique n'est touché. */
  const FEUILLE = 'Base Celtiis (MySQL)';

  /* .xls (Excel 97-2003) converti en .xlsx avant l'envoi : le serveur le lit alors en flux (≈ 1 s / 30 Mo au lieu de
     ≈ 8 s / 130 Mo), ce qui évite que l'hébergement mutualisé coupe l'import. Mêmes valeurs lues (vérifié ligne à ligne).
     En cas d'échec de la conversion, le fichier d'origine est envoyé tel quel. */
  async function versXlsx(f) {
    if (!/\.xls$/i.test(f.name) || !window.XLSX) return f;
    try {
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
      const contenu = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
      return new File([contenu], f.name.replace(/\.xls$/i, '.xlsx'), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', lastModified: f.lastModified });
    } catch (e) { console.warn('Conversion .xls → .xlsx impossible, envoi du fichier d\'origine', e); return f; }
  }

  async function sauvegarderDonnees(fichier) {
    if (!fichier) return null;
    try {
      progres(100, 'Préparation du fichier…');
      const envoi = await versXlsx(fichier);
      progres(100, 'Envoi vers la base de données…');
      const r = await CT.api.souscriptions.importer(envoi);
      if (r.statut === 'deja_importe') CT.toast(r.message, 'info', 6000);
      else if (r.statut === 'importe') {
        const st = r.stats, n = CT.fmt.int, f = st.feuilles || [], fi = f.filter((x) => x.statut === 'importee').length;
        CT.toast('Base mise à jour : ' + n(st.nouvelles) + ' nouvelle(s), ' + n(st.modifiees) + ' modifiée(s), ' + n(st.inchangees) + ' déjà présente(s)' + (st.plus_anciennes ? ', ' + n(st.plus_anciennes) + ' plus ancienne(s) que la base, ignorée(s)' : '') + (st.rejetees ? ', ' + st.rejetees + ' rejetée(s)' : '')
          + (f.length > 1 ? ' · ' + fi + ' feuille(s) de données importée(s) sur ' + f.length + ' (' + (f.length - fi) + ' synthèse(s) ignorée(s))' : '') + '.', 'ok', 9000);
      }
      const st = r.stats || {};
      await chargerDonnees(st.au ? { du: st.du && st.du < debutMoisDe(st.au) ? st.du : debutMoisDe(st.au), au: st.au } : null);
      CT.dashboard.synthese();
      return r;
    } catch (e) {
      console.error(e);
      progres(0, '');
      // Rien n'a été écrit (transaction annulée côté serveur) : on n'affiche pas un calcul qui n'existe pas en base
      CT.dashboard.synthese();   // l'échec apparaît dans le journal des imports
      if (!(await chargerDonnees())) { etat.res = null; etat.lignes = []; etat.meta = null; etat.qualite = null; etat.jourRef = null; }
      if (etat.res) classerEtCalculer();
      rendreTout();
      CT.modal({ titre: 'Import non enregistré', actions: [{ label: 'Compris', valeur: true, variante: 'primary' }],
        corps: '<div class="alert neg"><span class="alert-ic">' + CT.icone('critique') + '</span><div><strong>' + CT.esc(fichier.name) + '</strong><span>' + CT.esc(e.message) + '</span></div></div>'
          + '<p class="muted" style="margin-top:12px">Aucune ligne n\'a été enregistrée : la base de données est restée dans son état précédent. Corrigez le fichier puis relancez l\'import.</p>' });
      return null;
    }
  }

  /* Charge une plage de dates depuis la base, sur un ou plusieurs mois (par défaut : plageRequise, sinon le mois le plus récent).
     Filtres supportés par l'API : mois, du, au, statut, type_client, agence, login, offre. */
  async function chargerDonnees(plage) {
    try {
      const per = await CT.api.souscriptions.periodes();
      if (!per.mois.length) return false;
      etat.bornes = { du: per.du, au: per.au };
      etat.periodeDefaut = per.periode_defaut;   // période du dernier fichier importé (calculée côté serveur)
      const dernier = per.mois[per.mois.length - 1];
      const pl = plage || plageRequise() || { du: dernier.du, au: dernier.au };
      const data = await CT.api.souscriptions.aoa({ du: pl.du, au: pl.au });
      if (!data.lignes.length) return false;
      const res = await CT.parser.depuisAoa([data.entetes].concat(data.lignes), null, FEUILLE);
      const imp = per.dernier_import;
      const libelle = pl.du.slice(0, 7) === pl.au.slice(0, 7) ? CT.date.libelleMois(pl.au.slice(0, 7)) : CT.date.libelleMois(pl.du.slice(0, 7)) + ' → ' + CT.date.libelleMois(pl.au.slice(0, 7));
      res.meta = { nom: 'Base de données · ' + libelle + (imp ? ' · dernier import : ' + imp.nom : ''), taille: 0 };
      const jours = res.lignes.filter((l) => l.jour).map((l) => l.jour).sort();
      const au = jours[jours.length - 1]; if (!au) return false;
      const cfg = CT.store.get().partenaires, P = CT.store.actifs(au.slice(0, 7));
      CT.parser.classer(res.lignes, P.regles, cfg);
      etat.res = res; etat.lignes = res.lignes; etat.meta = res.meta; etat.qualite = CT.parser.controleQualite(res, P.regles);
      etat.jourRef = etat.qualite.au; etat.jourDu = null; etat.charge = { du: pl.du, au: pl.au };
      return true;
    } catch (e) {
      console.warn('Chargement depuis la base impossible :', e);
      if (!plage) CT.toast('Base de données injoignable : ' + e.message, 'err', 7000);
      return false;
    }
  }

  /* Bibliothèque Excel : si la version avec styles (xlsx-js-style) est indisponible, repli sur SheetJS (sans mise en forme des en-têtes) */
  function assurerXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((res) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = res; sc.onerror = res; document.head.append(sc); });
  }

  /* ---------- Menu mobile ---------- */
  function mobileMenuInit() {
    const btn = $('#mobile-menu-btn');
    const nav = $('#nav');
    const overlay = $('#mobile-overlay');
    if (!btn || !nav) return;
    const closeMenu = () => {
      nav.classList.remove('is-open');
      overlay.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
      document.body.style.overflow = '';
    };
    const openMenu = () => {
      nav.classList.add('is-open');
      overlay.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      document.body.style.overflow = 'hidden';
    };
    btn.addEventListener('click', () => {
      const isOpen = nav.classList.contains('is-open');
      if (isOpen) closeMenu(); else openMenu();
    });
    overlay.addEventListener('click', closeMenu);
    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });
  }

  /* ---------- Démarrage ---------- */
  async function init() {
    // Vue demandée par l'URL (retour depuis parametres.html) affichée tout de suite, sans attendre le chargement des données
    vue(HASH[location.hash] || 'dashboard');
    window.addEventListener('hashchange', () => vue(HASH[location.hash] || 'dashboard'));
    await assurerXlsx();
    await CT.store.pret;   // paramètres chargés depuis la base avant tout calcul
    themeInit();
    mobileMenuInit();
    CT.dashboard.synthese();
    $('#theme-btn').addEventListener('click', () => { const cur = document.documentElement.getAttribute('data-theme') || 'auto'; appliquerTheme(THEMES[(THEMES.indexOf(cur) + 1) % 3]); rafraichirGraphiques(); });
    $$('[data-goto]').forEach((b) => b.addEventListener('click', () => { location.hash = '#dashboard'; vue('dashboard'); setTimeout(() => $('#btn-import') && $('#btn-import').focus(), 50); }));
    window.addEventListener('scroll', () => $('.app-header').classList.toggle('is-scrolled', window.scrollY > 4), { passive: true });
    // Barre de partage
    const actions = { xlsx: () => CT.partage.telecharger('xlsx'), pdf: () => CT.partage.telecharger('pdf'), csv: () => CT.partage.telecharger('csv'), whatsapp: CT.partage.whatsapp, gmail: CT.partage.gmail,
      outlook: CT.partage.outlook, natif: CT.partage.partagerNatif, copier: () => CT.partage.copier(), imprimer: CT.partage.imprimer, global: CT.partage.exportGlobal };
    $$('#sharebar [data-action]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.action]()));
    if (!(navigator.canShare && navigator.share)) { const n = $('#sharebar [data-action="natif"]'); n && n.setAttribute('title', 'Partage natif : disponible sur mobile'); }
    // Filtres de date globaux : début + fin = période (voir normaliserPeriode) ; recalcul complet des deux pages, sans reclasser les lignes
    const debutInput = $('#global-date-debut');
    const finInput = $('#global-date-fin');
    const resetBtn = $('#reset-filters');
    // Persistance des filtres de dates (survit à la navigation vers /parametres et au retour)
    const CLE_DATES = 'ct_filtres_dates';
    const dateIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
    const sauverDates = () => {
      try {
        const d = debutInput ? debutInput.value : '', f = finInput ? finInput.value : '';
        if (d || f) sessionStorage.setItem(CLE_DATES, JSON.stringify({ debut: d, fin: f })); else sessionStorage.removeItem(CLE_DATES);
      } catch (_) { /* stockage indisponible : on ignore */ }
    };
    const restaurerDates = () => {
      try {
        const s = JSON.parse(sessionStorage.getItem(CLE_DATES) || 'null');
        if (!s) return false;
        if (debutInput && dateIso(s.debut)) debutInput.value = s.debut;
        if (finInput && dateIso(s.fin)) finInput.value = s.fin;
        return !!((debutInput && debutInput.value) || (finInput && finInput.value));
      } catch (_) { return false; }
    };
    // Dates mémorisées remises AVANT le premier chargement : la bonne plage (un ou plusieurs mois) est chargée du premier coup.
    // Lignes déjà classées par chargerDonnees ; le calcul et l'affichage sont faits une seule fois, en fin d'init
    const datesMemorisees = restaurerDates();
    if (await chargerDonnees()) CT.toast('Données chargées depuis la base de données.', 'info', 4000);
    appliquerDates = async () => {
      if (!etat.res) return;
      // Période hors des lignes en mémoire (autre mois, plusieurs mois) : on charge la plage nécessaire depuis la base
      const pl = plageRequise(), c = etat.charge;
      if (pl && (!c || pl.du < c.du || pl.au > c.au)) {
        const d = debutInput ? debutInput.value : '', f = finInput ? finInput.value : '';
        if (await chargerDonnees(pl)) { if (debutInput) debutInput.value = d; if (finInput) finInput.value = f; }
        else CT.toast('Aucune donnée en base du ' + CT.date.court(pl.du) + ' au ' + CT.date.court(pl.au) + '.', 'warn', 4000);
      }
      classerEtCalculer(true);
      // Synchroniser avec les filtres du tableau de bord
      const fDu = $('#f-du'), fAu = $('#f-au');
      if (fDu) fDu.value = etat.dashDu || debutMoisDe(etat.jourRef);
      if (fAu) fAu.value = etat.jourRef;
      rendreTout();
      sauverDates();   // après normaliserPeriode : on mémorise les dates réellement appliquées (bornées, remises dans l'ordre)
    };
    if (debutInput) debutInput.addEventListener('change', appliquerDates);
    if (finInput) finInput.addEventListener('change', appliquerDates);
    // « Réinitialiser » revient à la période par défaut (dernier fichier importé), pas à des champs vides
    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (!datesParDefaut()) { if (debutInput) debutInput.value = ''; if (finInput) finInput.value = ''; }
      appliquerDates();
    });
    // Paramètres modifiés (même page ou autre onglet) → recalcul automatique
    window.addEventListener('parametersUpdated', () => { if (etat.res) { classerEtCalculer(); rendreTout(); CT.toast('Paramètres mis à jour : rapports recalculés.', 'info', 3500); } });
    window.addEventListener('beforeunload', (e) => { if (analyseEnCours) { e.preventDefault(); e.returnValue = ''; } });
    // Retour sur la page : on remet les dates mémorisées et on recalcule (charge le bon mois si besoin)
    // Ouverture : dates choisies plus tôt dans la session, sinon période du dernier fichier importé — appliquée tout de suite
    // appliquerDates calcule ET affiche ; sinon un seul calcul (sans reclasser) puis un seul rendu
    if (etat.res && (datesMemorisees || datesParDefaut())) await appliquerDates();
    else { if (etat.res) classerEtCalculer(true); rendreTout(); }
  }
  CT.app = { vue, rendreTout, classerEtCalculer };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();