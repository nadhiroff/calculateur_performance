/* ============================================================================
   mon-espace.js — espace d'un commercial RGZ (calculateur/mon-espace.php).
   Quatre rubriques (menu) : Tableau de bord · Mes ventes (B2C / B2B) · Mon équipe · Primes & défis.
   Toutes les données viennent de l'API agent/tableau (calculées côté serveur, mêmes règles que le tableau de bord RGZ) ;
   une seule requête par période, les rubriques se dessinent ensuite à partir de la même réponse.
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const API = new URL('../api/index.php', location.href).pathname;
  const contenu = $('#contenu'), apercu = contenu.dataset.login || '';
  const nf = new Intl.NumberFormat('fr-FR'), n = (v) => nf.format(Math.round(v || 0));
  const fcfa = (v) => n(v) + ' FCFA';
  const pct = (v) => Math.round((v || 0) * 100) + ' %';
  const dec = (v) => String(v).replace('.', ',');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const d = (iso) => new Date(iso.slice(0, 10) + 'T12:00:00');
  const court = (iso) => d(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const jourCourt = (iso) => d(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  const moisLong = (iso) => d(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const ton = (r) => (r == null ? '' : r >= 1 ? '' : r >= 0.8 ? 'moyen' : 'faible');
  const rangTxt = (r) => (r === 1 ? '1<sup>er</sup>' : r + '<sup>e</sup>');
  const pluriel = (v, mot) => n(v) + ' ' + mot + (Math.abs(v) > 1 ? 's' : '');
  const sansFtth = (login) => String(login || '').replace(/\.ftth$/i, '');

  const VUES = { accueil: 'Tableau de bord', ventes: 'Mes ventes', equipe: 'Mon équipe', primes: 'Primes & défis' };
  let data = null, vue = 'accueil', enCours = null, graphes = [];
  const apres = [];   // graphiques et listes à brancher une fois le HTML de la rubrique en place

  /* ---------- Chargement (une requête par période ; la précédente est annulée) ---------- */
  async function charger(du, au) {
    if (enCours) enCours.abort();
    const ctrl = enCours = new AbortController();
    contenu.setAttribute('aria-busy', 'true'); $('#periode').classList.add('charge');
    const q = new URLSearchParams({ route: 'agent/tableau' });
    if (du) q.set('du', du); if (au) q.set('au', au); if (apercu) q.set('login', apercu);
    try {
      const rep = await fetch(API + '?' + q, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: ctrl.signal });
      if (rep.status === 401) { location.href = 'espace.php?expiree=1'; return; }
      const r = await rep.json().catch(() => null);
      if (!rep.ok || !r) throw new Error((r && r.message) || 'Erreur serveur (' + rep.status + ')');
      data = r;
      $('#du').value = r.periode.du; $('#au').value = r.periode.au;
      ['#du', '#au'].forEach((s) => { $(s).min = r.donnees.du || ''; $(s).max = r.donnees.au || ''; });
      $('#qui-login').textContent = r.agent.login; $('#qui-equipe').textContent = r.agent.equipe || '—';
      $('#maj').textContent = (r.periode.du === r.periode.au ? 'Le ' + court(r.periode.du) : 'Du ' + court(r.periode.du) + ' au ' + court(r.periode.au)) + ' · données à jour au ' + court(r.donnees.au);
      afficher();
    } catch (e) {
      if (e.name === 'AbortError') return;
      contenu.innerHTML = `<div class="grille"><div class="erreur"><b>Impossible de charger vos résultats.</b><br>${esc(e.message)}<br><button type="button" id="reessayer">Réessayer</button></div></div>`;
      $('#reessayer').onclick = () => charger($('#du').value, $('#au').value);
    } finally { if (enCours === ctrl) { enCours = null; contenu.setAttribute('aria-busy', 'false'); $('#periode').classList.remove('charge'); } }
  }

  /* Période : filtre automatique dès qu'une date change (court délai pour laisser finir la saisie au clavier) */
  let delai = null;
  const filtrer = () => {
    clearTimeout(delai);
    delai = setTimeout(() => {
      let du = $('#du').value, au = $('#au').value;
      if (!du || !au || du.length !== 10 || au.length !== 10) return;
      if (data && du === data.periode.du && au === data.periode.au) return;
      if (du > au) [du, au] = [au, du];
      charger(du, au);
    }, 350);
  };
  ['#du', '#au'].forEach((s) => $(s).addEventListener('change', filtrer));
  $('#periode').addEventListener('submit', (e) => { e.preventDefault(); filtrer(); });
  $('#reinit').addEventListener('click', () => charger());   // sans dates : dernières données (du 1er du mois au dernier jour en base)

  /* ---------- Menu (hamburger sur téléphone) et rubriques ---------- */
  const menu = (ouvrir) => { document.body.classList.toggle('menu-ouvert', ouvrir); $('#hamburger').setAttribute('aria-expanded', String(ouvrir)); };
  $('#hamburger').addEventListener('click', () => menu(!document.body.classList.contains('menu-ouvert')));
  $('#voile').addEventListener('click', () => menu(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu(false); });
  window.addEventListener('hashchange', () => { choisirVue(); afficher(); });
  function choisirVue() {
    const h = location.hash.slice(1); vue = VUES[h] ? h : 'accueil';
    $$('.menu a[data-vue]').forEach((a) => a.classList.toggle('actif', a.dataset.vue === vue));
    $('#titre-vue').textContent = VUES[vue]; document.title = VUES[vue] + ' — RGZ Mon espace';
    menu(false);
  }
  function afficher() {
    if (!data) return;
    graphes.forEach((g) => g.destroy()); graphes = []; apres.length = 0;
    const p = data.periode, vide = !data.moi.periode.ventes && !data.moi.periode.attente;
    const bandeau = vide ? `<div class="sans-donnees" role="status"><i class="fa-solid fa-circle-info"></i><span>Aucune vente ${p.du === p.au ? 'le ' + court(p.du) : 'du ' + court(p.du) + ' au ' + court(p.au)} sur cette période</span>`
      + (p.au !== data.donnees.au || p.du !== data.donnees.au.slice(0, 8) + '01' ? '<button type="button" id="dernieres">Voir les dernières données</button>' : '') + '</div>' : '';
    contenu.innerHTML = '<div class="grille">' + bandeau + ({ accueil: vueAccueil, ventes: vueVentes, equipe: vueEquipe, primes: vuePrimes }[vue])(data) + '</div>';
    const btn = $('#dernieres'); if (btn) btn.onclick = () => charger();
    requestAnimationFrame(() => $$('.anneau .val[data-cible]').forEach((c) => { c.style.strokeDashoffset = c.dataset.cible; }));
    apres.splice(0).forEach((f) => f());
    window.scrollTo({ top: 0 });
  }

  /* ---------- Briques ---------- */
  const anneau = (r, titre, clair = false) => {
    const C = 2 * Math.PI * 46;
    return `<div class="anneau${clair ? ' clair' : ''}" role="img" aria-label="${esc(titre)} : ${pct(r)}"><svg viewBox="0 0 112 112"><circle class="fond" cx="56" cy="56" r="46"/><circle class="val ${ton(r)}" cx="56" cy="56" r="46" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-cible="${C * (1 - Math.min(r || 0, 1))}"/></svg><div class="centre"><b class="num">${pct(r)}</b><small>${esc(titre)}</small></div></div>`;
  };
  const barre = (r, cls = '') => `<div class="barrette"><span class="${cls || ton(r)}" style="width:${Math.max(0, Math.min(100, Math.round((r || 0) * 100)))}%"></span></div>`;
  const tuile = (ic, titre, val, obj, aide, cls = 'c-3') => `<div class="tuile ${cls}"><div class="t"><i class="fa-solid ${ic}"></i>${titre}</div>
    <div class="v num">${n(val)}${obj ? ' <small>/ ' + n(obj) + '</small>' : ''}</div><div class="a">${aide}</div>${obj ? barre(val / obj) : ''}</div>`;
  const carte = (cls, ic, titre, sous, corps) => `<section class="carte ${cls}"><h2><i class="fa-solid ${ic}"></i>${titre}</h2>${sous ? `<p class="sous">${sous}</p>` : ''}${corps}</section>`;
  function dessiner(id, cfg) {
    const cv = document.getElementById(id); if (!cv) return;   // rubrique quittée entre-temps
    if (!window.Chart) { setTimeout(() => dessiner(id, cfg), 300); return; }
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    Chart.defaults.color = css('--text-3'); Chart.defaults.borderColor = css('--border'); Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    graphes.push(new Chart(cv, cfg(css)));
  }
  const graphe = (id, cfg) => apres.push(() => dessiner(id, cfg));
  const optionsBarres = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } } },
    scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } };

  /* Message d'encouragement selon la situation du mois */
  function encouragement(t) {
    const mo = t.moi.mois, pj = t.motivation.projection, ch = t.motivation.champion;
    if (!mo || !mo.objectif) return 'Chaque vente compte : continuez sur votre lancée !';
    if (ch && ch.moi) return `<b>Bravo, vous avez été champion RGZ du ${court(ch.jour)} !</b> Gardez ce rythme.`;
    if (mo.tro >= 1) return '<b>Objectif du mois atteint, félicitations !</b> Chaque vente de plus vous rapproche du palier suivant.';
    if (mo.ecart >= 0) return `<b>Vous êtes en avance</b> sur l'objectif. À ce rythme, vous finirez le mois à <b>${n(pj.fin_de_mois)} ventes</b>.`;
    return pj && pj.par_jour ? `Encore un effort : <b>${pluriel(pj.par_jour, 'vente')} par jour</b> sur les ${pj.ouvres_restants} jours ouvrés restants et l'objectif est atteint.`
      : 'Le mois se termine : chaque vente compte pour votre palier.';
  }

  /* ---------- Rubrique : Tableau de bord ---------- */
  function vueAccueil(t) {
    const m = t.moi, mo = m.mois, per = m.periode, mv = t.motivation, pj = mv.projection, fin = court(t.periode.au), lib = moisLong(t.periode.au);
    const etiquette = !mo || mo.obj_a_date <= 0 ? '' : mo.ecart >= 0
      ? `<span class="etiquette pos"><i class="fa-solid fa-arrow-trend-up"></i> En avance de ${pluriel(mo.ecart, 'vente')}</span>`
      : `<span class="etiquette neg"><i class="fa-solid fa-arrow-trend-down"></i> ${pluriel(-mo.ecart, 'vente')} de retard</span>`;
    let h = mo && mo.objectif
      ? `<section class="carte heros c-8">${anneau(mo.tro, "de l'objectif")}<div style="min-width:0"><h2>Objectif de ${esc(lib)}</h2>
          <div class="grand num">${n(mo.ventes)} / ${n(mo.objectif)} ventes</div>
          <small>Attendu au ${fin} : ${n(mo.obj_a_date)} · reste ${n(mo.reste)} · ${mo.ouvres_ecoules}/${mo.ouvres_mois} jours ouvrés</small><br>${etiquette}
          <div class="message">${encouragement(t)}</div></div></section>`
      : `<section class="carte heros c-8"><div><h2>${pluriel(per.ventes, 'vente validée')}</h2><small>Aucun objectif enregistré pour vous en ${esc(lib)}. Rapprochez-vous de votre superviseur.</small></div></section>`;
    h += pj ? carte('defi c-4', 'fa-bullseye', 'Mon défi', 'Pour atteindre l\'objectif du mois',
      pj.reste > 0 ? `<div class="gros num">${n(pj.par_jour)} <small>vente${pj.par_jour > 1 ? 's' : ''} / jour</small></div>
        <p>sur les <b>${pj.ouvres_restants}</b> jours ouvrés restants (${pluriel(pj.reste, 'vente')} à faire).</p>
        <p class="pousse">À votre rythme actuel (${dec(pj.rythme)} / jour), vous finirez à <b>${n(pj.fin_de_mois)} ventes</b> (${pct(pj.tro)})${pj.palier ? ', palier « ' + esc(pj.palier) + ' »' : ''}.</p>`
        : `<div class="gros">🎉</div><p><b>Objectif atteint !</b> À ce rythme : ${n(pj.fin_de_mois)} ventes en fin de mois${pj.palier ? ', palier « ' + esc(pj.palier) + ' »' : ''}.</p>`)
      : carte('c-4', 'fa-bullseye', 'Mon défi', '', '<p class="vide">Pas d\'objectif ce mois-ci.</p>');

    h += tuile('fa-cart-shopping', 'Ventes de la période', per.ventes, per.objectif, n(per.b2c) + ' B2C · ' + n(per.b2b) + ' B2B')
      + tuile('fa-calendar-day', 'Le ' + court(m.jour.date), m.jour.ventes, m.jour.objectif, m.jour.objectif ? 'Objectif du jour' : 'Jour non ouvré ou sans objectif')
      + tuile('fa-calendar-week', 'Cette semaine', m.semaine.ventes, m.semaine.objectif, 'Depuis le ' + court(m.semaine.depuis))
      + tuile('fa-hourglass-half', 'En attente', per.attente, null, per.attente ? Object.entries(per.attente_detail).map(([s, v]) => n(v) + ' ' + esc(s.toLowerCase())).join(' · ') : 'Ventes pas encore validées');

    h += carte('c-8', 'fa-chart-column', 'Mes ventes jour par jour', 'Ventes validées de la période (en vert : objectif du jour atteint)', '<div class="graphe remplit"><canvas id="g-jours"></canvas></div>');
    graphe('g-jours', (css) => ({ data: { labels: per.jours.map((j) => jourCourt(j.jour)), datasets: [
      { type: 'bar', label: 'Ventes validées', data: per.jours.map((j) => j.ventes), backgroundColor: per.jours.map((j) => (j.objectif && j.ventes >= j.objectif ? css('--pos') : css('--primary-600'))), borderRadius: 4, maxBarThickness: 28 },
      { type: 'line', label: 'Objectif du jour', data: per.jours.map((j) => j.objectif), borderColor: css('--warn'), borderDash: [5, 4], pointRadius: 0, borderWidth: 2 },
    ] }, options: optionsBarres }));
    h += calendrier(t, 'c-4');

    h += carte('c-4 t-6', 'fa-ranking-star', 'Mon classement', 'Taux de réalisation du mois au ' + fin, `<div class="rangs pousse">
      <div class="rang"><b>${m.rang.equipe ? rangTxt(m.rang.equipe) : '—'}</b><small>sur ${n(m.rang.sur_equipe)} dans l'équipe</small></div>
      <div class="rang"><b>${m.rang.reseau ? rangTxt(m.rang.reseau) : '—'}</b><small>sur ${n(m.rang.sur_reseau)} commerciaux RGZ</small></div></div>`);
    const suivant = mo && mo.primes.suivant;
    h += carte('c-4 t-6', 'fa-stairs', 'Prochain palier', mo && mo.primes.palier ? 'Palier actuel : « ' + esc(mo.primes.palier) + ' »' : 'Aucun palier atteint pour l\'instant',
      suivant ? `<div class="pousse"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>« ${esc(suivant.nom)} »</b><b class="num" style="color:var(--pos-text)">+${fcfa(suivant.prime)}</b></div>
        ${barre(mo.ventes / Math.max(1, mo.ventes + suivant.manque), 'ambre')}<p class="note" style="margin-top:8px">Encore <b>${pluriel(suivant.manque, 'vente')}</b> pour le décrocher.</p></div>`
        : `<p class="pousse">${mo && mo.primes.eligible ? '<b>Tous les paliers sont atteints, bravo !</b>' : 'Primes non applicables à votre compte ce mois-ci.'}</p>`);
    h += championCarte(t, 'c-4');
    return h;
  }

  function calendrier(t, cls) {
    const mv = t.motivation, fin = t.periode.au, cal = mv.calendrier;
    const decalage = (d(cal[0].jour).getDay() + 6) % 7;
    const cases = Array(decalage).fill('<span></span>').join('') + cal.map((c) => {
      const k = c.futur ? 'futur' : !c.ouvre ? 'repos' : c.reussi ? 'reussi' : c.ventes > 0 ? 'vente' : '';
      return `<span class="j ${k}${c.jour === fin ? ' aujourdhui' : ''}" title="${court(c.jour)}${c.futur ? '' : ' : ' + pluriel(c.ventes, 'vente')}">${+c.jour.slice(8)}${!c.futur && c.ventes > 0 ? '<b>' + c.ventes + '</b>' : ''}</span>`;
    }).join('');
    return carte(cls, 'fa-calendar-check', 'Mon mois', 'Journée réussie = objectif du jour atteint',
      `<div class="cal">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span class="jl">${x}</span>`).join('')}${cases}</div>
      <div class="legende"><span style="--c:var(--pos)">Réussie</span><span style="--c:var(--primary-soft)">Avec ventes</span><span style="--c:var(--surface-2)">Sans vente</span></div>
      <div class="faits pousse"><div class="fait"><b class="num">${mv.record ? n(mv.record.ventes) : '—'}</b><small>record${mv.record ? ' (' + court(mv.record.jour) + ')' : ''}</small></div>
        <div class="fait"><b class="num">${n(mv.serie_vente)}</b><small>jour${mv.serie_vente > 1 ? 's' : ''} d'affilée avec vente</small></div>
        <div class="fait"><b class="num">${n(t.moi.mois ? t.moi.mois.primes.journees : 0)}</b><small>journées réussies</small></div></div>`);
  }

  function championCarte(t, cls) {
    const ch = t.motivation.champion;
    return carte(cls, 'fa-crown', 'Champion RGZ du jour', ch ? 'Meilleur taux de réalisation le ' + court(ch.jour) : '',
      ch ? `<div class="champion pousse"><span class="couronne"><i class="fa-solid fa-crown"></i></span><span><b>${ch.moi ? 'C\'est vous !' : esc(sansFtth(ch.login))}</b>
        <small>Équipe ${esc(ch.equipe)} · ${pluriel(ch.ventes, 'vente')} ce jour-là</small></span></div><p class="note">Chaque jour, le meilleur commercial RGZ gagne la prime « champion du jour ». Pourquoi pas vous ?</p>`
        : '<p class="vide">Pas encore de champion ce mois-ci : la place est à prendre !</p>');
  }

  /* ---------- Rubrique : Mes ventes (B2C / B2B) ---------- */
  function vueVentes(t) {
    const per = t.moi.periode, mo = t.moi.mois, V = t.ventes, ok = V.filter((v) => v.compte);
    const ca = ok.reduce((s, v) => s + v.montant, 0), caB2B = ok.filter((v) => v.segment === 'B2B').reduce((s, v) => s + v.montant, 0);
    let h = tuile('fa-circle-check', 'Ventes validées', per.ventes, null, 'Sur la période')
      + tuile('fa-house', 'Particuliers (B2C)', per.b2c, null, per.ventes ? pct(per.b2c / per.ventes) + ' de vos ventes' : '—')
      + tuile('fa-building', 'Entreprises (B2B)', per.b2b, null, per.ventes ? pct(per.b2b / per.ventes) + ' de vos ventes' : '—')
      + `<div class="tuile c-3"><div class="t"><i class="fa-solid fa-coins"></i>Chiffre d'affaires validé</div><div class="v num" style="font-size:1.3rem">${fcfa(ca)}</div><div class="a">dont ${fcfa(caB2B)} en B2B</div></div>`;

    h += carte('c-4 t-6', 'fa-chart-pie', 'Répartition B2C / B2B', 'Ventes validées de la période', '<div class="graphe petit pousse"><canvas id="g-seg"></canvas></div>');
    graphe('g-seg', (css) => ({ type: 'doughnut', data: { labels: ['B2C', 'B2B'], datasets: [{ data: [per.b2c, per.b2b], backgroundColor: [css('--primary-600'), css('--accent-rgz')], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } } } }));
    h += mo ? carte('c-4 t-6', 'fa-flag-checkered', 'Objectifs par segment', 'Mois de ' + esc(moisLong(t.periode.au)) + ', au ' + court(t.periode.au), `<div class="pousse">
        <div style="display:flex;justify-content:space-between"><span>Particuliers (B2C)</span><b class="num">${n(mo.b2c)} / ${n(mo.obj_b2c)}</b></div>${barre(mo.obj_b2c ? mo.b2c / mo.obj_b2c : 0, 'bleu')}
        <div style="display:flex;justify-content:space-between;margin-top:16px"><span>Entreprises (B2B)</span><b class="num">${n(mo.b2b)} / ${n(mo.obj_b2b)}</b></div>${barre(mo.obj_b2b ? mo.b2b / mo.obj_b2b : 0, 'ambre')}
        ${mo.primes.bonus_b2b_possible ? `<p class="note">${mo.primes.bonus_b2b ? '✅ Bonus B2B gagné : ' + fcfa(mo.primes.bonus_b2b) : 'Atteignez l\'objectif B2B pour gagner un bonus de <b>' + fcfa(mo.primes.bonus_b2b_possible) + '</b>.'}</p>` : ''}</div>`)
      : carte('c-4 t-6', 'fa-flag-checkered', 'Objectifs par segment', '', '<p class="vide">Pas d\'objectif ce mois-ci.</p>');
    const offres = {}; ok.forEach((v) => { offres[v.offre || '—'] = (offres[v.offre || '—'] || 0) + 1; });
    const top = Object.entries(offres).sort((a, b) => b[1] - a[1]).slice(0, 5);
    h += carte('c-4', 'fa-box-open', 'Mes offres les plus vendues', 'Ventes validées de la période', top.length ? `<ul class="classement">${top.map(([o, c], i) =>
      `<li><span class="pos">${i + 1}</span><span class="nom"><b title="${esc(o)}">${esc(o)}</b>${barre(c / top[0][1], 'bleu')}</span><span class="val num">${n(c)}</span></li>`).join('')}</ul>` : '<p class="vide">Aucune vente validée sur la période.</p>');

    const nb = (f) => V.filter(f).length;
    h += carte('c-12', 'fa-list-check', 'Détail de mes ventes', V.length >= 500 ? '500 ventes les plus récentes de la période' : pluriel(V.length, 'vente') + ' sur la période',
      `<div class="onglets" role="group" aria-label="Filtrer"><button type="button" data-f="tout" class="actif">Toutes (${n(V.length)})</button><button type="button" data-f="B2C">B2C (${n(nb((v) => v.segment === 'B2C'))})</button><button type="button" data-f="B2B">B2B (${n(nb((v) => v.segment === 'B2B'))})</button><button type="button" data-f="att">En attente (${n(nb((v) => !v.compte))})</button></div>
      <div class="table-zone"><table class="ventes"><thead><tr><th>Date</th><th>Client</th><th class="col-o">Offre</th><th class="col-t">Type</th><th class="col-s">Statut</th><th style="text-align:right">Montant</th></tr></thead><tbody id="lignes"></tbody></table></div><p class="compteur" id="compteur"></p>`);
    apres.push(() => {
      const peindre = (f) => {
        const l = V.filter((v) => f === 'tout' || (f === 'att' ? !v.compte : v.segment === f));
        $('#lignes').innerHTML = l.map((v) => `<tr><td class="d">${new Date(v.date.replace(' ', 'T')).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</td>
          <td class="client"><b>${esc(v.client)}</b><span class="o-mob"><span class="pastille ${v.compte ? 'ok' : 'att'}">${esc(v.statut)}</span> ${v.segment} · ${esc(v.offre || '—')}</span></td><td class="o" title="${esc(v.offre)}">${esc(v.offre || '—')}</td>
          <td class="t"><span class="pastille ${v.segment === 'B2B' ? 'b2b' : 'b2c'}">${v.segment}</span></td><td class="s"><span class="pastille ${v.compte ? 'ok' : 'att'}">${esc(v.statut)}</span></td><td class="m num">${n(v.montant)}</td></tr>`).join('')
          || '<tr><td colspan="6" class="vide">Aucune vente dans cette catégorie.</td></tr>';
        $('#compteur').textContent = l.length > 8 ? pluriel(l.length, 'ligne') + ' · faites défiler le tableau pour voir la suite' : '';
        $('.table-zone').scrollTop = 0;
      };
      $$('.onglets button').forEach((b) => b.addEventListener('click', () => { $$('.onglets button').forEach((x) => x.classList.toggle('actif', x === b)); peindre(b.dataset.f); }));
      peindre('tout');
    });
    return h;
  }

  /* ---------- Rubrique : Mon équipe (totaux et classements, aucune vente détaillée) ---------- */
  function vueEquipe(t) {
    const eq = t.equipe, mo = t.moi.mois, fin = court(t.periode.au), lib = moisLong(t.periode.au);
    const ecart = eq.mois.ventes - eq.mois.obj_a_date;
    let h = `<section class="carte heros c-8">${anneau(eq.mois.tro, 'objectif équipe')}<div style="min-width:0"><h2>Équipe ${esc(eq.nom || '—')}</h2>
      <div class="grand num">${n(eq.mois.ventes)} / ${n(eq.mois.objectif)} ventes</div>
      <small>${esc(lib)} · attendu au ${fin} : ${n(eq.mois.obj_a_date)} · ${pluriel(eq.membres.length, 'membre')}</small><br>
      ${eq.mois.obj_a_date > 0 ? `<span class="etiquette ${ecart >= 0 ? 'pos' : 'neg'}">${ecart >= 0 ? 'En avance de ' + pluriel(ecart, 'vente') : pluriel(-ecart, 'vente') + ' de retard'}</span>` : ''}
      ${eq.rang ? `<span class="etiquette neutre"><i class="fa-solid fa-ranking-star"></i> ${eq.rang === 1 ? '1re' : eq.rang + 'e'} équipe sur ${eq.nb_equipes}</span>` : ''}</div></section>`;
    h += carte('c-4', 'fa-hand-holding-heart', 'Ma contribution', 'Ma part des ventes de l\'équipe ce mois-ci', eq.ma_part != null
      ? `<div class="pousse" style="display:flex;flex-direction:column;align-items:center">${anneau(eq.ma_part, 'des ventes', true)}
        <p class="note" style="text-align:center">Vous : <b>${n(mo ? mo.ventes : 0)}</b> ventes · moyenne de l'équipe : <b>${dec(eq.moyenne)}</b> par membre</p></div>`
      : '<p class="vide">Pas encore de ventes dans l\'équipe.</p>');

    h += carte('c-6', 'fa-people-group', 'Classement de l\'équipe', esc(lib) + ', au ' + fin + ' · taux de réalisation', `<ul class="classement">${eq.membres.map((x, i) => `<li class="${x.moi ? 'moi' : ''}"><span class="pos">${i + 1}</span>
      <span class="nom"><b>${esc(sansFtth(x.login))}${x.moi ? ' (moi)' : ''}</b><small>${n(x.ventes_mois)} / ${n(x.objectif)} ce mois · ${n(x.ventes_periode)} sur la période</small>${barre(x.tro)}</span>
      <span class="val num">${x.objectif ? pct(x.tro) : '—'}</span></li>`).join('') || '<li class="vide">Aucun membre.</li>'}</ul>`);
    h += carte('c-6', 'fa-chart-line', 'Ventes de l\'équipe jour par jour', esc(lib) + ', du 1<sup>er</sup> au ' + fin, '<div class="graphe remplit"><canvas id="g-equipe"></canvas></div>');
    h += carte('c-12', 'fa-flag', 'Classement des équipes RGZ', 'Taux de réalisation de l\'objectif d\'équipe · ' + esc(lib) + ', au ' + fin, `<ul class="classement deux">${t.equipes.map((e, i) => `<li class="${e.moi ? 'moi' : ''}"><span class="pos">${i + 1}</span>
      <span class="nom"><b>${esc(e.nom)}${e.moi ? ' (mon équipe)' : ''}</b><small>${n(e.ventes)} / ${n(e.objectif)} ventes · ${pluriel(e.membres, 'membre')}</small>${barre(e.tro)}</span>
      <span class="val num">${e.objectif ? pct(e.tro) : '—'}</span></li>`).join('')}</ul>`);
    const objJ = eq.mois.obj_a_date && t.calendrier.ouvres_ecoules ? eq.mois.obj_a_date / t.calendrier.ouvres_ecoules : null;
    const ouvres = new Set(t.motivation.calendrier.filter((c) => c.ouvre).map((c) => c.jour));
    graphe('g-equipe', (css) => ({ data: { labels: eq.jours.map((j) => jourCourt(j.jour)), datasets: [
      { type: 'bar', label: 'Ventes de l\'équipe', data: eq.jours.map((j) => j.ventes), backgroundColor: css('--primary-600'), borderRadius: 4, maxBarThickness: 28 },
      ...(objJ ? [{ type: 'line', label: 'Objectif d\'équipe par jour', data: eq.jours.map((j) => (ouvres.has(j.jour) ? Math.round(objJ * 10) / 10 : null)), borderColor: css('--warn'), borderDash: [5, 4], pointRadius: 0, borderWidth: 2 }] : []),
    ] }, options: optionsBarres }));
    return h;
  }

  /* ---------- Rubrique : Primes & défis ---------- */
  function vuePrimes(t) {
    const mo = t.moi.mois, mv = t.motivation, pj = mv.projection, lib = moisLong(t.periode.au), fin = court(t.periode.au);
    if (!mo || !mo.primes.eligible) return carte('c-12', 'fa-trophy', 'Primes & défis', '', '<p class="vide">Les primes ne s\'appliquent pas à votre compte ce mois-ci (pas d\'objectif enregistré).</p>') + badgesCarte(t);
    const pr = mo.primes;
    let h = `<section class="carte total-primes c-4"><h2 style="justify-content:center"><i class="fa-solid fa-coins"></i>Primes estimées</h2><p class="sous">${esc(lib)}, du 1<sup>er</sup> au ${fin}</p>
      <div class="gros num">${fcfa(pr.total)}</div>${pj && pj.prime_palier > pr.prime_palier ? `<p class="note">À votre rythme, le palier « ${esc(pj.palier)} » (${fcfa(pj.prime_palier)}) est à votre portée d'ici la fin du mois !</p>` : ''}
      <p class="note">Estimation selon les règles du mois ; le montant final est validé par la direction.</p></section>`;
    const suiv = mv.paliers.find((p) => !p.atteint);
    h += carte('c-8', 'fa-stairs', 'Échelle des paliers', 'Votre TRO du mois : ' + pct(mo.tro) + ' (' + n(mo.ventes) + ' / ' + n(mo.objectif) + ' ventes)', `<div class="echelle">${mv.paliers.map((p) => {
      const manque = p.ventes != null ? Math.max(0, p.ventes - mo.ventes) : null;
      return `<div class="palier ${p.atteint ? 'atteint' : p === suiv ? 'suivant' : ''}"><span class="ic"><i class="fa-solid ${p.atteint ? 'fa-check' : p === suiv ? 'fa-person-running' : 'fa-lock'}"></i></span>
        <span><b>${esc(p.nom)} · ${pct(p.seuil)}</b><small>${p.ventes != null ? n(p.ventes) + ' ventes' : ''}${p.atteint ? ' · atteint ✅' : manque ? ' · encore ' + pluriel(manque, 'vente') : ''}</small>${barre(p.ventes ? mo.ventes / p.ventes : 0, p.atteint ? '' : 'ambre')}</span>
        <span class="prime num">${fcfa(p.prime)}</span></div>`;
    }).join('')}</div>`);

    h += carte('c-6', 'fa-receipt', 'Détail de mes primes', '', `<ul class="lignes">
      <li><span>Palier du mois<small>${pr.palier ? '« ' + esc(pr.palier) + ' » atteint' : 'Aucun palier atteint pour l\'instant'}</small></span><b>${fcfa(pr.prime_palier)}</b></li>
      <li><span>Journées réussies<small>${n(pr.journees)} × ${fcfa(pr.prime_journee)} (objectif du jour atteint)</small></span><b>${fcfa(pr.prime_journees)}</b></li>
      <li><span>Champion du jour<small>${n(pr.champion)} fois meilleur commercial RGZ du jour</small></span><b>${fcfa(pr.prime_champion)}</b></li>
      ${pr.bonus_b2b_possible ? `<li><span>Bonus B2B<small>${pr.bonus_b2b ? 'Objectif B2B atteint' : n(mo.b2b) + ' / ' + n(mo.obj_b2b) + ' ventes B2B'}</small></span><b>${fcfa(pr.bonus_b2b)}</b></li>` : ''}
      <li><span><b>Total estimé</b></span><b style="color:var(--pos-text)">${fcfa(pr.total)}</b></li></ul>`);
    h += carte('c-6', 'fa-rocket', 'Projection de fin de mois', 'Si vous gardez votre rythme actuel', pj ? `<div class="faits" style="margin-top:0">
        <div class="fait"><b class="num">${dec(pj.rythme)}</b><small>ventes / jour ouvré</small></div>
        <div class="fait"><b class="num">${n(pj.fin_de_mois)}</b><small>ventes fin de mois</small></div>
        <div class="fait"><b class="num">${pct(pj.tro)}</b><small>TRO projeté</small></div></div>
        <div class="projbar" role="img" aria-label="Réalisé ${n(mo.ventes)}, projeté ${n(pj.fin_de_mois)}, objectif ${n(mo.objectif)}">
          <span class="proj" style="width:${Math.min(100, pj.fin_de_mois / Math.max(mo.objectif, pj.fin_de_mois) * 100)}%"></span><span class="real" style="width:${Math.min(100, mo.ventes / Math.max(mo.objectif, pj.fin_de_mois) * 100)}%"></span></div>
        <div class="projbar-leg"><span>Réalisé <b>${n(mo.ventes)}</b></span><span>Projeté <b>${n(pj.fin_de_mois)}</b></span><span>Objectif <b>${n(mo.objectif)}</b></span></div>
        <p class="note pousse" style="font-size:.8rem">${pj.reste > 0 ? `Pour atteindre <b>100 %</b>, il faut <b>${pluriel(pj.par_jour, 'vente')} par jour</b> sur les ${pj.ouvres_restants} jours ouvrés restants.` : '<b>Objectif atteint !</b> Visez maintenant le palier supérieur.'}
        ${pj.palier ? ' Palier projeté : <b>« ' + esc(pj.palier) + ' »</b> (' + fcfa(pj.prime_palier) + ').' : ''}</p>` : '<p class="vide">Projection indisponible.</p>');
    return h + badgesCarte(t);
  }

  /* Badges : récompenses symboliques, débloquées selon les résultats du mois (indication pour celles à gagner) */
  function badgesCarte(t) {
    const mo = t.moi.mois || { ventes: 0, tro: 0, primes: { journees: 0, champion: 0, bonus_b2b: 0, bonus_b2b_possible: 0 } }, mv = t.motivation, pr = mo.primes;
    const liste = [
      ['fa-seedling', 'Première vente', mo.ventes >= 1, 'Faire une vente validée ce mois-ci'],
      ['fa-sun', 'Journée réussie', pr.journees >= 1, 'Atteindre une fois l\'objectif du jour'],
      ['fa-fire', '5 journées réussies', pr.journees >= 5, n(pr.journees) + ' / 5 journées réussies'],
      ['fa-bolt', 'Série de 3 jours', mv.serie_vente >= 3, 'Vendre 3 jours ouvrés d\'affilée (actuellement ' + mv.serie_vente + ')'],
      ['fa-flag', 'Mi-parcours', mo.tro >= 0.5, 'Atteindre 50 % de l\'objectif (' + pct(mo.tro) + ')'],
      ...mv.paliers.map((p) => ['fa-medal', 'Palier ' + p.nom, p.atteint, 'Atteindre ' + pct(p.seuil) + ' de l\'objectif']),
      ['fa-building', 'Objectif B2B', pr.bonus_b2b > 0, pr.bonus_b2b_possible ? 'Atteindre l\'objectif B2B du mois' : 'Pas d\'objectif B2B ce mois-ci'],
      ['fa-crown', 'Champion du jour', pr.champion >= 1, 'Être le meilleur commercial RGZ d\'une journée'],
    ];
    const gagnes = liste.filter((b) => b[2]).length;
    return carte('c-12', 'fa-award', 'Mes badges', gagnes + ' sur ' + liste.length + ' débloqués ce mois-ci', `<div class="badges">${liste.map(([ic, nom, ok, aide]) =>
      `<div class="badge-s${ok ? ' gagne' : ''}"><i class="fa-solid ${ok ? ic : 'fa-lock'}"></i><b>${esc(nom)}</b><small>${ok ? 'Débloqué ✅' : esc(aide)}</small></div>`).join('')}</div>`);
  }

  /* ---------- Déconnexion : confirmation Oui / Non ---------- */
  const formSortie = $('#form-sortie'), dlg = $('#confirm-sortie');
  if (formSortie && dlg) {
    formSortie.addEventListener('submit', (e) => { if (formSortie._ok) return; e.preventDefault(); menu(false); dlg.showModal ? dlg.showModal() : (formSortie._ok = true, formSortie.submit()); });
    dlg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { dlg.close(); if (b.value === 'oui') { formSortie._ok = true; formSortie.submit(); } }));
  }

  choisirVue();
  charger();
})();
