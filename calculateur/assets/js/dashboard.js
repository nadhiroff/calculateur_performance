/* ============================================================================
   dashboard.js — tableau de bord : cartes KPI, objectifs RGZ, alertes, filtres dynamiques,
   graphiques Chart.js, classements et tableau détaillé.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  /* Palette catégorielle (ordre fixe validé daltonisme) lue dans les tokens CSS : suit le thème clair / sombre */
  const jeton = (nom) => getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
  const palette = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => jeton('--series-' + i));
  const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
  const charts = {};
  let tableDetail = null, filtres = { inclureAtypiques: false };
  const E = () => CT.etat;

  function chart(id, cfg) {
    const cv = document.getElementById(id); if (!cv) return;
    if (!window.Chart) { cv.parentElement.innerHTML = '<p class="muted">Graphique indisponible (Chart.js non chargé — vérifiez la connexion).</p>'; return; }
    if (charts[id]) charts[id].destroy();
    Chart.defaults.color = jeton('--text-3');
    Chart.defaults.borderColor = jeton('--chart-grid');
    Chart.defaults.font.family = '"Inter", system-ui, sans-serif';
    Chart.defaults.font.size = 12;
    Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: jeton('--brand-900'), titleColor: '#fff', bodyColor: '#E3E9F5', padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true });
    Object.assign(Chart.defaults.plugins.legend.labels, { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 8, boxHeight: 8, padding: 14 });
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false } }, cfg.options || {});
    const sc = cfg.options.scales;
    if (sc) Object.values(sc).forEach((a) => { a.border = { display: false }; a.grid = Object.assign({ color: jeton('--chart-grid') }, a.grid); });
    if (sc && sc.x) sc.x.grid.display = false;
    charts[id] = new Chart(cv, cfg);
  }
  const kpi = (icone, couleur, label, valeur, sub, cls = '') =>
    `<div class="kpi ${cls}"><div class="kpi-icon ${couleur}" aria-hidden="true"><i class="fa-solid ${icone}"></i></div><div><div class="kpi-label">${label}</div><div class="kpi-value num">${CT.valeurKpi(valeur)}</div><div class="kpi-sub">${sub}</div></div></div>`;
  const rank = (liste, max, fmt) => liste.length
    ? `<ol class="rank">${liste.map((g, i) => `<li><span class="pos-n">${i + 1}</span><div><div class="nm">${CT.esc(g.nom || g.cle)}</div><div class="bar" aria-hidden="true"><span style="width:${max ? Math.round((g.n / max) * 100) : 0}%"></span></div></div><b class="num">${fmt ? fmt(g) : CT.fmt.int(g.n)}</b></li>`).join('')}</ol>`
    : '<p class="muted">Aucune donnée.</p>';
  const barre = (reel, cible) => { const p = cible > 0 ? reel / cible : 0; return `<div class="progress ${p >= 1 ? 'pos' : p >= 0.6 ? '' : p >= 0.35 ? 'warn' : 'neg'}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(p * 100))}"><span style="width:${Math.min(100, p * 100)}%"></span></div>`; };

  function lireFiltres() {
    const g = (id) => (document.getElementById(id) || {}).value || '';
    const l = g('f-login').trim();
    return { du: g('f-du'), au: g('f-au'), partenaire: g('f-partenaire'), agence: g('f-agence'), login: l ? CT.cleLogin(l) : '', offre: g('f-offre'), typeClient: g('f-type'), statut: g('f-statut'),
      inclureAtypiques: !!(document.getElementById('f-atyp') || {}).checked };
  }
  /* Période du tableau de bord : champs Du / Au, sinon période globale (début saisi ou 1er du mois → date de fin). Peut couvrir plusieurs mois. */
  const periodeDash = () => { const e = E(), g = (id) => (document.getElementById(id) || {}).value || ''; return { du: g('f-du') || e.dashDu || e.jourRef.slice(0, 7) + '-01', au: g('f-au') || e.jourRef }; };
  /* Lignes du mois de calcul jusqu'à la date de fin (objectifs, alertes) : les lignes en mémoire peuvent couvrir plusieurs mois */
  const lignesPeriode = () => { const e = E(), d = CT.periode.perfDu(); return e.lignes.filter((l) => l.jour && l.jour >= d && l.jour <= e.jourRef); };
  const options = (valeurs, tous) => `<option value="">${tous}</option>` + valeurs.map((v) => `<option value="${CT.esc(v)}">${CT.esc(v)}</option>`).join('');

  function squelette() {
    const e = E(), L = e.lignes;
    const uniq = (f) => [...new Set(L.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const parts = uniq((l) => l.partenaire); const pr = e.prioritaire;
    parts.sort((a, b) => (a === pr ? -1 : b === pr ? 1 : a.localeCompare(b, 'fr')));
    const logins = uniq((l) => l.loginKey);
    return `
    <div class="stack">
      <section aria-label="Indicateurs clés"><div class="grid-kpi" id="kpis"></div></section>
      <div class="grid-3-1">
        <div class="stack">
          <section class="card" aria-labelledby="t-obj"><div class="card-head"><div><h3 id="t-obj">Objectifs ${CT.esc(pr)}</h3><p id="obj-sub"></p></div><span class="badge badge-rgz">Partenaire prioritaire</span></div><div class="obj-grid" id="obj-grid"></div></section>
          <section class="card" aria-labelledby="t-equipes"><div class="card-head"><div><h3 id="t-equipes">Top 5 des équipes</h3><p id="equipes-sub"></p></div></div><ol class="rank" id="top-equipes"></ol></section>
        </div>
        <section class="card" aria-labelledby="t-alert"><div class="card-head"><div><h3 id="t-alert">Alertes automatiques</h3><p>Écarts vs objectifs, baisses, vendeurs en retard</p></div></div><ul class="alerts" id="alertes"></ul></section>
      </div>
      <section class="card filters-card" aria-labelledby="t-filtres">
        <div class="card-head"><div><h3 id="t-filtres">Filtres</h3><p>Le recalcul est instantané. Les objectifs ${CT.esc(pr)} ci-dessus restent calculés sur tout le fichier.</p></div><button class="btn btn-ghost btn-sm" id="f-reset" type="button"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Réinitialiser</button></div>
        <div class="filters">
          <div class="field"><label for="f-du">Du</label><input class="input" type="date" id="f-du"></div>
          <div class="field"><label for="f-au">Au</label><input class="input" type="date" id="f-au"></div>
          <div class="field"><label for="f-partenaire">Partenaire</label><select class="select" id="f-partenaire">${options(parts, 'Tous les partenaires')}</select></div>
          <div class="field"><label for="f-agence">Agence</label><select class="select" id="f-agence">${options(uniq((l) => l.agence), 'Toutes les agences')}</select></div>
          <div class="field"><label for="f-login">Vendeur (login)</label><input class="input" id="f-login" list="dl-logins" placeholder="Tous les vendeurs" autocomplete="off"><datalist id="dl-logins">${logins.map((x) => `<option value="${CT.esc(x)}">`).join('')}</datalist></div>
          <div class="field"><label for="f-offre">Offre</label><select class="select" id="f-offre">${options(uniq((l) => l.offre), 'Toutes les offres')}</select></div>
          <div class="field"><label for="f-type">Type de client</label><select class="select" id="f-type">${options(uniq((l) => l.typeClient), 'Tous les types')}</select></div>
          <div class="field"><label for="f-statut">Statut</label><select class="select" id="f-statut">${options(uniq((l) => l.statut), 'Tous les statuts')}</select></div>
          <label class="check"><input type="checkbox" id="f-atyp"> Inclure les montants atypiques</label>
        </div>
      </section>
      <div class="grid-2">
        <section class="card"><div class="card-head"><div><h3>Souscriptions par jour</h3><p>Total et ventes validées (OK)</p></div></div><div class="chart-box"><canvas id="ch-jour" role="img" aria-label="Souscriptions par jour"></canvas></div></section>
        <section class="card"><div class="card-head"><div><h3>Évolution horaire</h3><p>Répartition des souscriptions par heure de la journée</p></div></div><div class="chart-box"><canvas id="ch-heure" role="img" aria-label="Souscriptions par heure"></canvas></div></section>
      </div>
      <div class="grid-2">
        <section class="card"><div class="card-head"><div><h3>Répartition par offre</h3></div></div><div class="chart-box"><canvas id="ch-offre" role="img" aria-label="Répartition par offre"></canvas></div></section>
        <section class="card"><div class="card-head"><div><h3>Type de client</h3><p id="seg-sub"></p></div></div><div class="chart-box"><canvas id="ch-type" role="img" aria-label="Répartition par type de client"></canvas></div></section>
      </div>
      <div class="grid-3">
        <section class="card"><div class="card-head"><div><h3>Top 5 vendeurs</h3><p>Par nombre de souscriptions</p></div></div><div id="top-vend"></div></section>
        <section class="card"><div class="card-head"><div><h3>Top 5 agences</h3></div></div><div id="top-ag"></div></section>
        <section class="card"><div class="card-head"><div><h3>Top 5 partenaires</h3></div></div><div id="top-part"></div></section>
      </div>
      <section class="card" aria-labelledby="t-detail"><div class="card-head"><div><h3 id="t-detail">Détail des souscriptions</h3><p id="detail-sub"></p></div></div><div id="detail"></div></section>
    </div>`;
  }

  /* ----- Objectifs / alertes : période [début → fin] des filtres (« Jour » = date de fin ; « Mois » = cible mensuelle) ----- */
  function rendreObjectifs() {
    const e = E(), m = e.motiv, r = m.reseau, sem = CT.periode.semaine(), obj = CT.periode.objectif(), dP = CT.periode.perfDu();
    const ligne = (titre, reel, cible, note) => `<div class="obj-row"><div class="top"><span>${titre}</span><b class="num">${CT.fmt.pct(cible ? reel / cible : 0)}</b></div>${barre(reel, cible)}<div class="mini-cap">${note}</div></div>`;
    document.getElementById('obj-sub').textContent = 'Ventes OK ' + e.prioritaire + ' du ' + CT.date.court(dP) + ' au ' + CT.date.court(e.jourRef) + (m.herite ? ' (objectifs hérités d\'un mois précédent)' : '');
    document.getElementById('obj-grid').innerHTML =
      ligne('Jour', r.ventesJour, r.objJour, CT.fmt.int(r.ventesJour) + ' / ' + CT.fmt.int(r.objJour) + ' — ' + CT.date.long(e.jourRef)) +
      ligne('Semaine', sem.ventes, sem.objectif, CT.fmt.int(sem.ventes) + ' / ' + CT.fmt.int(sem.objectif) + ' — du ' + CT.date.court(sem.du) + ' au ' + CT.date.court(e.jourRef)) +
      ligne('Période', obj.real, obj.objectif, CT.fmt.int(obj.real) + ' / ' + CT.fmt.int(obj.objectif) + ' — objectif du ' + CT.date.court(dP) + ' au ' + CT.date.court(e.jourRef)) +
      ligne('Mois (cible)', r.real, r.objMois, CT.fmt.int(r.real) + ' / ' + CT.fmt.int(r.objMois) + ' — ' + CT.date.libelleMois(e.cle).toLowerCase() + ', au ' + CT.date.court(e.jourRef));
    const ic = { pos: 'succes', warn: 'alerte', neg: 'critique', info: 'info' };
    document.getElementById('alertes').innerHTML = CT.calc.alertes(lignesPeriode(), e.motivPerf).map((a) => `<li class="alert ${a.niveau}"><span class="alert-ic">${CT.icone(ic[a.niveau])}</span><div><strong>${CT.esc(a.titre)}</strong><span>${CT.esc(a.detail)}</span></div></li>`).join('');
    rendreTopEquipes();
  }

  function rendreTopEquipes() {
    // Équipes du partenaire prioritaire (fichier d'objectifs) : mêmes chiffres que le Point du jour
    const e = E(), m = e.motivPJ || e.motiv;
    const equipes = [...m.equipes].filter((q) => q.ventesJour > 0).sort((a, b) => b.ventesJour - a.ventesJour).slice(0, 5)
      .map((q) => ({ cle: q.id, n: q.ventesJour, pct: q.realisation }));
    document.getElementById('equipes-sub').textContent = 'Période : ' + (e.jourDu ? CT.date.court(e.jourDu) + ' → ' + CT.date.court(e.jourRef) : CT.date.long(e.jourRef));
    document.getElementById('top-equipes').innerHTML = equipes.length
      ? equipes.map((g, i) => {
          const pct = g.pct || 0;
          return `<li><span class="pos-n">${i + 1}</span><div><div class="nm">${CT.esc(g.cle)}</div><div class="bar" aria-hidden="true"><span style="width:${Math.min(100, pct * 100)}%"></span></div></div><div class="text-right"><b class="num">${CT.fmt.int(g.n)}</b><small class="muted">${g.pct == null ? '—' : CT.fmt.pct(pct)}</small></div></li>`;
        }).join('')
      : '<p class="muted">Aucune donnée d\'équipe.</p>';
  }

  /* ----- Partie filtrée : KPI, graphiques, tops, tableau ----- */
  function rendreFiltre() {
    const e = E(); filtres = lireFiltres();
    const R = e.motiv.regles, seuil = R.seuil_montant_atypique || 1e6;
    const L = CT.calc.filtrer(e.lignes, filtres); e.filtre = L; e.kpiFiltre = CT.calc.kpis(L, { seuil, inclureAtypiques: filtres.inclureAtypiques });
    const k = e.kpiFiltre, obj = CT.periode.objectif();
    document.getElementById('kpis').innerHTML =
      kpi('fa-file-signature', '', 'Souscriptions', CT.fmt.int(k.total), CT.fmt.int(k.ok) + ' OK · ' + CT.fmt.int(k.b2b) + ' B2B · ' + CT.fmt.int(k.b2c) + ' B2C') +
      kpi('fa-coins', 'pos', 'Chiffre d\'affaires', CT.fmt.fcfa(k.ca), k.atyp ? 'hors ' + k.atyp + ' montant atypique (' + CT.fmt.fcfa(k.atypMontant) + ')' : 'MONTANT_TOTAL cumulé') +
      kpi('fa-circle-check', 'info', 'Taux de réussite', CT.fmt.pct(k.taux, 1), 'STATUS = OK / total') +
      kpi('fa-hourglass-half', 'warn', 'En attente (VALIDE)', CT.fmt.int(k.valide), CT.fmt.pct(k.total ? k.valide / k.total : 0, 1) + ' du total, non comptées') +
      kpi('fa-basket-shopping', '', 'Panier moyen', CT.fmt.fcfa(k.panier), 'CA ÷ souscriptions') +
      kpi('fa-bullseye', obj.taux != null && obj.taux >= 1 ? 'pos' : 'warn', 'Objectif ' + e.prioritaire + ' — période', obj.taux == null ? '—' : CT.fmt.pct(obj.taux, 1), CT.fmt.int(obj.real) + ' / ' + CT.fmt.int(obj.objectif) + ' ventes OK');
    // Graphiques
    const q = CT.calc.quotidien(L), PAL = palette(), surface = jeton('--surface');
    const barres = { borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: false, borderWidth: { top: 0, left: 1, right: 1 }, borderColor: surface, maxBarThickness: 22 };
    chart('ch-jour', { type: 'bar', data: { labels: q.map((d) => d.jour.slice(8) + '/' + d.jour.slice(5, 7)), datasets: [Object.assign({ label: 'Souscriptions', data: q.map((d) => d.n), backgroundColor: PAL[0] }, barres), Object.assign({ label: 'Validées (OK)', data: q.map((d) => d.ok), backgroundColor: PAL[2] }, barres)] }, options: { plugins: { legend: { position: 'bottom' } }, scales: { x: {}, y: { beginAtZero: true } } } });
    chart('ch-heure', { type: 'line', data: { labels: Array.from({ length: 24 }, (_, i) => i + 'h'), datasets: [{ label: 'Souscriptions', data: CT.calc.horaire(L), borderColor: PAL[0], backgroundColor: alpha(PAL[0], .12), fill: true, tension: .35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: surface }] }, options: { plugins: { legend: { display: false } }, scales: { x: {}, y: { beginAtZero: true } } } });
    const offres = CT.calc.grouper(L, (l) => l.offre, seuil); const top = offres.slice(0, 7), autres = CT.somme(offres.slice(7), (g) => g.n);
    const dOff = top.map((g) => ({ n: g.cle, v: g.n })).concat(autres ? [{ n: 'Autres offres', v: autres }] : []);
    // « Autres offres » en gris neutre : la couleur reste attachée à l'entité, jamais au rang
    const donut = (id, labels, data) => chart(id, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: labels.map((l, i) => (l === 'Autres offres' ? jeton('--series-other') : PAL[i % PAL.length])), borderWidth: 2, borderColor: surface, hoverOffset: 6 }] },
      options: { cutout: '64%', interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => ' ' + c.label + ' : ' + CT.fmt.int(c.parsed) + ' (' + CT.fmt.pct(c.parsed / (data.reduce((a, b) => a + b, 0) || 1), 1) + ')' } } } } });
    donut('ch-offre', dOff.map((d) => d.n), dOff.map((d) => d.v));
    const types = CT.calc.grouper(L, (l) => l.typeClient);
    donut('ch-type', types.map((g) => g.cle), types.map((g) => g.n));
    document.getElementById('seg-sub').textContent = 'B2B = ORGANISATION (' + CT.fmt.int(k.b2b) + ') · B2C = PHYSIQUE (' + CT.fmt.int(k.b2c) + ')';
    // Classements
    const tv = CT.calc.grouper(L, (l) => l.loginKey).slice(0, 5); document.getElementById('top-vend').innerHTML = rank(tv, tv[0] && tv[0].n);
    const ta = CT.calc.grouper(L, (l) => l.agence).slice(0, 5); document.getElementById('top-ag').innerHTML = rank(ta, ta[0] && ta[0].n);
    const tp = CT.calc.grouper(L, (l) => l.partenaire).slice(0, 5); document.getElementById('top-part').innerHTML = rank(tp, tp[0] && tp[0].n);
    // Tableau détaillé
    document.getElementById('detail-sub').textContent = CT.fmt.int(L.length) + ' ligne(s) après filtres';
    const lignes = L.map((l) => ({ date: (l.jour ? CT.date.court(l.jour) : '—') + ' ' + String(l.heure == null ? '' : l.heure).padStart(2, '0') + 'h', ts: l.ts, partenaire: l.partenaire, login: l.loginKey, agence: l.agence, offre: l.offre, type: l.typeClient, segment: l.segment, statut: l.statut, montant: l.montant }));
    const cols = [
      { cle: 'date', titre: 'Date', tri: (r) => r.ts }, { cle: 'partenaire', titre: 'Partenaire' }, { cle: 'login', titre: 'Vendeur' }, { cle: 'agence', titre: 'Agence' }, { cle: 'offre', titre: 'Offre' },
      { cle: 'segment', titre: 'Segment' }, { cle: 'statut', titre: 'Statut', html: true, fmt: (v) => `<span class="badge ${v === 'OK' ? 'badge-pos' : 'badge-warn'}">${CT.esc(v)}</span>` },
      { cle: 'montant', titre: 'Montant', num: true, fmt: (v) => CT.fmt.fcfa(v) }];
    const hote = document.getElementById('detail');
    if (!tableDetail) { tableDetail = CT.table.creer({ colonnes: cols, lignes, recherche: true, caption: 'Détail des souscriptions', triInit: { cle: 'date', dir: 'desc' }, classeLigne: (r) => (r.partenaire === e.prioritaire ? 'row-rgz' : '') }); hote.replaceChildren(tableDetail.el); }
    else { if (!hote.contains(tableDetail.el)) hote.replaceChildren(tableDetail.el); tableDetail.maj(lignes); }
  }

  /* ----- Vue d'ensemble de TOUTE la base (Directeur) : indépendante du mois affiché ----- */
  const depuis = (iso) => { const d = (Date.now() - new Date(iso).getTime()) / 60000; return d < 1 ? 'à l\'instant' : d < 60 ? 'il y a ' + Math.round(d) + ' min' : d < 1440 ? 'il y a ' + Math.round(d / 60) + ' h' : 'le ' + new Date(iso).toLocaleDateString('fr-FR'); };
  const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 2 });
  /* Suit la période choisie (dates de l'en-tête / Du-Au du tableau de bord), sur un ou plusieurs mois ou années ; sans données chargées : année en cours.
     siChange : ne recharge que si la période a changé. Une réponse arrivée après une plus récente est ignorée. */
  let numSynthese = 0, cleSynthese = null;
  async function synthese(siChange) {
    const zone = document.getElementById('synthese'); if (!zone) return;
    const e = E(), p = e.lignes.length && e.jourRef ? periodeDash() : null, cle = p ? p.du + '|' + p.au : '';
    if (siChange === true && cle === cleSynthese) return;
    const num = ++numSynthese;
    let s;
    try { s = await CT.api.synthese(p || undefined); } catch (err) { if (num === numSynthese) zone.hidden = true; return; }
    if (num !== numSynthese) return;
    cleSynthese = cle;
    const t = s.totaux, im = s.imports, n = CT.fmt.int, per = s.periode;
    const libPer = per ? 'du ' + CT.date.court(per.du) + ' au ' + CT.date.court(per.au) : 'année ' + s.annee, suffixe = per ? '' : ' ' + s.annee;
    if (!s.par_mois.length && !im.derniers.length) { zone.hidden = true; return; }   // base vide : rien à montrer (en début d'année, le graphique et le journal restent visibles)
    const dernier = im.derniers.find((i) => i.statut === 'ok');
    const stat = (icone, label, valeur, sub) => `<div class="hero-stat"><div class="lbl"><i class="fa-solid ${icone}" aria-hidden="true"></i>${label}</div><div class="val">${valeur}</div><div class="sub">${sub}</div></div>`;
    const lib = { ok: ['fa-check', '', 'Réussi'], echec: ['fa-xmark', 'neg', 'Échec'], en_cours: ['fa-spinner', 'info', 'En cours'] };
    zone.innerHTML = `
      <div class="overview-hero">
        <div class="hero-row">
          <div><span class="eyebrow">Vue d'ensemble</span><h2>Activité globale de la plateforme</h2>
            <p>${per ? 'Période ' + libPer + ' · ' : ''}${t.du ? 'Souscriptions du ' + CT.date.court(t.du) + ' au ' + CT.date.court(t.au) + ' · ' + n(t.mois) + ' mois couverts' : per ? 'Aucune souscription sur cette période' : 'Aucune souscription en ' + s.annee + ' pour le moment'}</p></div>
          <span class="pill-live"><span class="dot" aria-hidden="true"></span>${dernier ? 'Dernier import ' + depuis(dernier.date) : 'Aucun import réussi'}</span>
        </div>
        <div class="hero-stats">
          ${stat('fa-database', per ? 'Lignes de la période' : 'Lignes ' + s.annee, n(t.lignes), n(t.mois) + ' mois · ' + n(t.offres) + ' offres')}
          ${stat('fa-circle-check', 'Ventes validées (OK)', n(t.ok), CT.fmt.pct(t.lignes ? t.ok / t.lignes : 0, 1) + ' des souscriptions')}
          ${stat('fa-coins', 'CA validé', '<span title="' + CT.fmt.fcfa(t.ca_ok) + '">' + compact.format(t.ca_ok) + '\u00a0FCFA</span>', 'Statut OK, ' + libPer)}
          ${stat('fa-users', 'Vendeurs actifs' + suffixe, n(t.vendeurs), n(t.agences) + ' agence(s)')}
          ${stat('fa-file-arrow-up', per ? 'Imports de la période' : 'Imports réussis ' + s.annee, n(im.ok) + ' / ' + n(im.total), im.echec ? n(im.echec) + ' en échec' : 'Aucun échec')}
        </div>
      </div>
      <div class="grid-3-1">
        <section class="card"><div class="card-head"><div><h3>Volume par mois</h3><p>Souscriptions enregistrées et ventes validées (OK)${s.par_mois.length > 12 ? ' · 12 derniers mois de la période' : ''}</p></div></div><div class="chart-box"><canvas id="ch-mois" role="img" aria-label="Souscriptions par mois"></canvas></div></section>
        <section class="card"><div class="card-head"><div><h3>Derniers imports</h3><p>Journal des fichiers traités</p></div></div>
          <ul class="activity">${im.derniers.map((i) => { const [ic, cls, txt] = lib[i.statut] || lib.en_cours;
            const det = i.statut === 'ok' && i.nouvelles != null ? n(i.nouvelles) + ' nouvelle(s) · ' + n(i.modifiees || 0) + ' modifiée(s)' + (i.feuilles ? ' · ' + i.feuilles + ' feuille(s)' : '') : i.type === 'objectifs' ? 'Objectifs mensuels' : (i.erreur || '');
            return `<li><span class="ic ${cls}" aria-hidden="true"><i class="fa-solid ${ic}"></i></span><div><div class="nm" title="${CT.esc(i.nom)}">${CT.esc(i.nom)}</div><small title="${CT.esc(det)}">${CT.esc(det)}</small></div><div style="text-align:right"><span class="badge ${cls === 'neg' ? 'badge-neg' : cls ? 'badge-info' : 'badge-pos'}">${txt}</span><small>${i.date ? depuis(i.date) : ''}</small></div></li>`; }).join('') || '<li class="muted">Aucun import.</li>'}</ul></section>
      </div>`;
    zone.hidden = false;
    const PAL = palette(), m = s.par_mois.slice(-12), surface = jeton('--surface');
    const barres = { borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: false, borderWidth: { top: 0, left: 1, right: 1 }, borderColor: surface, maxBarThickness: 28 };
    chart('ch-mois', { type: 'bar', data: { labels: m.map((x) => CT.date.libelleMois(x.mois)), datasets: [
      Object.assign({ label: 'Souscriptions', data: m.map((x) => x.lignes), backgroundColor: PAL[0] }, barres),
      Object.assign({ label: 'Validées (OK)', data: m.map((x) => x.ok), backgroundColor: PAL[2] }, barres)] },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ' ' + c.dataset.label + ' : ' + n(c.parsed.y) } } }, scales: { x: {}, y: { beginAtZero: true } } } });
  }

  CT.dashboard = {
    synthese, periodeDash,
    render() {
      const e = E(), zone = document.getElementById('dash-content');
      if (!e.lignes.length) { zone.hidden = true; zone.innerHTML = ''; tableDetail = null; return; }
      zone.hidden = false;
      const garde = zone.querySelector('#f-du') ? lireFiltres() : null;
      zone.innerHTML = squelette(); tableDetail = null;
      const q = e.qualite;
      // Bornes = toutes les dates en base (pas seulement le mois chargé) : choisir un autre mois le charge via les filtres globaux
      const b = e.bornes || q;
      ['f-du', 'f-au'].forEach((id) => { const i = document.getElementById(id); i.min = b.du; i.max = b.au; });
      if (garde) { // restaure les filtres après un recalcul (ex. paramètres modifiés)
        const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
        set('f-du', garde.du); set('f-au', garde.au); set('f-partenaire', garde.partenaire); set('f-agence', garde.agence); set('f-offre', garde.offre); set('f-type', garde.typeClient); set('f-statut', garde.statut);
        set('f-login', garde.login); document.getElementById('f-atyp').checked = garde.inclureAtypiques;
      }
      const p = periodeDash(); document.getElementById('f-du').value = p.du; document.getElementById('f-au').value = p.au;
      // Du / Au pilotent les dates globales (date de début / fin) : appliquerDates charge le bon mois puis resynchronise ces champs
      [['f-du', 'global-date-debut'], ['f-au', 'global-date-fin']].forEach(([id, gid]) => {
        const g = document.getElementById(gid);
        document.getElementById(id).addEventListener('change', (ev) => { ev.stopImmediatePropagation(); if (!g) return rendreFiltre(); g.value = ev.target.value; g.dispatchEvent(new Event('change')); });
      });
      zone.querySelectorAll('.filters select, .filters input').forEach((el) => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', CT.debounce(rendreFiltre, 120)));
      document.getElementById('f-reset').addEventListener('click', () => { zone.querySelectorAll('.filters select, .filters input').forEach((el) => { if (el.type === 'checkbox') el.checked = false; else el.value = ''; }); const p = periodeDash(); document.getElementById('f-du').value = p.du; document.getElementById('f-au').value = p.au; rendreFiltre(); CT.toast('Filtres réinitialisés.', 'ok', 2500); });
      rendreObjectifs(); rendreFiltre();
      synthese(true);   // vue d'ensemble : suit la période
    },
    refreshTheme() { if (E().lignes.length) rendreFiltre(); synthese(); },

    resume() {
      const e = E(), k = e.kpiFiltre || CT.calc.kpis(e.lignes), r = e.motiv.reseau;
      const top = CT.calc.grouper(e.filtre || e.lignes, (l) => l.loginKey).slice(0, 3).map((g) => CT.loginCourt(g.cle) + ' (' + g.n + ')').join(', ');
      return [
        'Rapport souscriptions Celtiis — du ' + CT.date.court(periodeDash().du) + ' au ' + CT.date.court(periodeDash().au),
        '• Souscriptions : ' + CT.fmt.int(k.total) + ' (' + CT.fmt.int(k.ok) + ' OK, ' + CT.fmt.int(k.valide) + ' en attente)',
        '• CA : ' + CT.fmt.fcfa(k.ca) + ' — panier moyen ' + CT.fmt.fcfa(k.panier),
        '• Taux de réussite : ' + CT.fmt.pct(k.taux, 1),
        '• Objectif ' + e.prioritaire + ' : jour ' + CT.fmt.int(r.ventesJour) + '/' + CT.fmt.int(r.objJour) + ' (' + CT.fmt.pct(r.realisation) + '), période ' + CT.fmt.int(CT.periode.objectif().real) + '/' + CT.fmt.int(CT.periode.objectif().objectif) + (CT.periode.objectif().taux == null ? '' : ' (' + CT.fmt.pct(CT.periode.objectif().taux, 1) + ')'),
        top ? '• Top vendeurs : ' + top : '',
      ].filter(Boolean).map(CT.fmt.txt).join('\n');
    },
    feuilles() {
      const e = E(), L = e.filtre || e.lignes, k = e.kpiFiltre || CT.calc.kpis(L), r = e.motiv.reseau;
      return [
        { nom: 'KPI', aoa: [['Indicateur', 'Valeur'], ['Période', CT.date.court(periodeDash().du) + ' → ' + CT.date.court(periodeDash().au)], ['Souscriptions', k.total], ['Ventes validées (OK)', k.ok], ['En attente (VALIDE)', k.valide],
          ['Taux de réussite', k.taux], ['CA (FCFA)', k.ca], ['Panier moyen (FCFA)', Math.round(k.panier)], ['B2B', k.b2b], ['B2C', k.b2c],
          ['Objectif ' + e.prioritaire + ' de la période', CT.periode.objectif().objectif], ['Réalisé ' + e.prioritaire + ' de la période (OK)', CT.periode.objectif().real], ['% atteinte période', CT.periode.objectif().taux == null ? '' : CT.periode.objectif().taux],
          ['Objectif ' + e.prioritaire + ' du mois', r.objMois], ['Réalisé ' + e.prioritaire + ' du mois (OK)', r.real], ['Objectif du jour', r.objJour], ['Ventes du jour', r.ventesJour]], cols: [34, 24] },
        { nom: 'Top vendeurs', aoa: [['Vendeur', 'Souscriptions', 'OK']].concat(CT.calc.grouper(L, (l) => l.loginKey).slice(0, 20).map((g) => [g.cle, g.n, g.ok])), cols: [32, 14, 10] },
        { nom: 'Top agences', aoa: [['Agence', 'Souscriptions', 'OK', 'CA (FCFA)']].concat(CT.calc.grouper(L, (l) => l.agence).slice(0, 20).map((g) => [g.cle, g.n, g.ok, g.ca])), cols: [32, 14, 10, 16] },
        { nom: 'Offres', aoa: [['Offre', 'Souscriptions', 'OK', 'CA (FCFA)']].concat(CT.calc.grouper(L, (l) => l.offre).map((g) => [g.cle, g.n, g.ok, g.ca])), cols: [44, 14, 10, 16] },
        { nom: 'Par jour', aoa: [['Jour', 'Souscriptions', 'OK']].concat(CT.calc.quotidien(L).map((d) => [d.jour, d.n, d.ok])), cols: [14, 14, 10] },
        { nom: 'Par heure', aoa: [['Heure', 'Souscriptions']].concat(CT.calc.horaire(L).map((n, i) => [i + 'h', n])), cols: [10, 14] },
      ];
    },
  };
})();
