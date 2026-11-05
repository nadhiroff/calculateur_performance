/* ============================================================================
   mon-espace.js — espace d'un commercial RGZ (calculateur/mon-espace.php).
   Menu en groupes, une page par sous-menu : Tableau de bord · Mes résultats (mois, B2C / B2B, détail) ·
   Mon équipe (classement, évolution, équipes, champion) · Primes & défis (primes, paliers, projection, badges).
   Toutes les données viennent de l'API agent/tableau (calculées côté serveur, mêmes règles que le tableau de bord RGZ) ;
   une seule requête par période, les rubriques se dessinent ensuite à partir de la même réponse.
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const API = new URL('../api/index.php', location.href).pathname;
  const contenu = $('#contenu'), apercu = contenu.dataset.login || '';
  let accueilAFaire = contenu.dataset.accueil === '1';   // une fois par connexion (session), jamais en aperçu administrateur
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

  /* Pages : titre affiché et groupe du menu qui les contient (ouvert automatiquement) */
  const VUES = {
    accueil: ['Tableau de bord', null],
    'mon-mois': ['Mon mois jour par jour', 'resultats'], ventes: ['Ventes B2C / B2B', 'resultats'], detail: ['Détail de mes ventes', 'resultats'],
    equipe: ['Classement de l\'équipe', 'equipe'], 'equipe-evolution': ['Évolution de l\'équipe', 'equipe'], equipes: ['Classement des équipes', 'equipe'], champion: ['Champion du jour', 'equipe'],
    primes: ['Mes primes', 'primes'], paliers: ['Paliers', 'primes'], projection: ['Projection fin de mois', 'primes'], badges: ['Mes badges', 'primes'],
  };
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
      if (rep.status === 401) { sortir(await rep.json().catch(() => null)); return; }
      const r = await rep.json().catch(() => null);
      if (!rep.ok || !r) throw new Error((r && r.message) || 'Erreur serveur (' + rep.status + ')');
      data = r;
      $('#du').value = r.periode.du; $('#au').value = r.periode.au;
      ['#du', '#au'].forEach((s) => { $(s).min = r.donnees.du || ''; $(s).max = r.donnees.au || ''; });
      $('#qui-login').textContent = r.agent.login; $('#qui-equipe').textContent = r.agent.equipe || '—';
      $('#maj').textContent = (r.periode.du === r.periode.au ? 'Le ' + court(r.periode.du) : 'Du ' + court(r.periode.du) + ' au ' + court(r.periode.au)) + ' · données à jour au ' + court(r.donnees.au);
      afficher();
      if (accueilAFaire) { accueilAFaire = false; annonceChampion(r); }
    } catch (e) {
      if (e.name === 'AbortError') return;
      contenu.innerHTML = `<div class="grille"><div class="erreur"><b>Impossible de charger vos résultats.</b><br>${esc(e.message)}<br><button type="button" id="reessayer">Réessayer</button></div></div>`;
      $('#reessayer').onclick = () => charger($('#du').value, $('#au').value);
    } finally { if (enCours === ctrl) { enCours = null; contenu.setAttribute('aria-busy', 'false'); $('#periode').classList.remove('charge'); } }
  }

  /* Session fermée (code réinitialisé par l'administrateur, ou expirée) : retour à la connexion avec le bon message */
  let sortie = false;
  const sortir = (r) => {
    if (sortie) return; sortie = true;
    const code = r && r.raison === 'code';
    // Message en plein écran pendant 3 s : le commercial comprend pourquoi il quitte son espace
    const voile = document.createElement('div');
    voile.className = 'deconnecte'; voile.setAttribute('role', 'alertdialog'); voile.setAttribute('aria-modal', 'true');
    voile.innerHTML = `<div class="boite"><span class="ic"><i class="fa-solid ${code ? 'fa-rotate' : 'fa-lock'}" aria-hidden="true"></i></span>
      <h2>Vous êtes déconnecté</h2><p>${code ? 'Votre code a été réinitialisé. Reconnectez-vous avec votre login, puis choisissez un nouveau code.' : 'Votre session a expiré. Reconnectez-vous avec votre login et votre code.'}</p>
      <small>Retour à la page de connexion…</small></div>`;
    document.body.appendChild(voile);
    setTimeout(() => location.replace('espace.php?' + (code ? 'reinit=1' : 'expiree=1')), 3000);
  };
  /* Contrôle toutes les 10 s (et dès que l'on revient sur l'onglet) : un code réinitialisé déconnecte en quelques secondes
     tous les appareils où le commercial est connecté. Pas en aperçu administrateur. */
  if (!apercu) {
    const verifier = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const rep = await fetch(API + '?route=agent/session', { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
        if (rep.status === 401) sortir(await rep.json().catch(() => null));
      } catch (e) { /* hors connexion : on réessaie au prochain tour */ }
    };
    setInterval(verifier, 10000);
    document.addEventListener('visibilitychange', verifier);
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
    $$('.menu a[data-vue]').forEach((a) => { a.classList.toggle('actif', a.dataset.vue === vue); if (a.dataset.vue === vue) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    // Groupe de la page affichée : ouvert et marqué ; les autres se referment (menu court, facile à parcourir)
    $$('.menu-groupe').forEach((g) => { const ici = g.dataset.groupe === VUES[vue][1]; g.classList.toggle('contient-actif', ici); g.open = ici; });
    $('#titre-vue').textContent = VUES[vue][0]; document.title = VUES[vue][0] + ' — RGZ Mon espace';
    menu(false);
  }
  function afficher() {
    if (!data) return;
    graphes.forEach((g) => g.destroy()); graphes = []; apres.length = 0;
    const p = data.periode, vide = !data.moi.periode.ventes && !data.moi.periode.attente;
    const bandeau = vide ? `<div class="sans-donnees" role="status"><i class="fa-solid fa-circle-info"></i><span>Aucune vente ${p.du === p.au ? 'le ' + court(p.du) : 'du ' + court(p.du) + ' au ' + court(p.au)} sur cette période</span>`
      + (p.au !== data.donnees.au || p.du !== data.donnees.au.slice(0, 8) + '01' ? '<button type="button" id="dernieres">Voir les dernières données</button>' : '') + '</div>' : '';
    contenu.innerHTML = '<div class="grille">' + bandeau + PAGES[vue](data) + '</div>';
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

  /* Qui dépasser dans l'équipe : ventes à faire pour passer devant le collègue juste au-dessus (même ordre que le classement :
     taux de réalisation du mois, puis nombre de ventes). 1er : de combien de ventes le 2e est derrière. */
  function aDepasser(t) {
    const L = t.equipe.membres, i = L.findIndex((x) => x.moi);
    if (i < 0) return null;
    const moi = L[i], taux = (x) => (x.objectif ? x.ventes_mois / x.objectif : 0);
    const devant = (v, o, x) => { const a = o ? v / o : 0, b = taux(x); return a > b + 1e-9 || (Math.abs(a - b) <= 1e-9 && v > x.ventes_mois); };
    const manque = (de, vers) => { if (!de.objectif) return null; for (let v = 1; v <= 2000; v++) if (devant(de.ventes_mois + v, de.objectif, vers)) return v; return null; };
    if (i === 0) return { rang: 1, sur: L.length, suivant: L[1] || null, avance: L[1] ? manque(L[1], moi) : null };
    return { rang: i + 1, sur: L.length, devant: L[i - 1], manque: manque(moi, L[i - 1]), premier: L[0], manquePremier: i > 1 ? manque(moi, L[0]) : null };
  }
  function carteDepasser(t, cls) {
    const r = aDepasser(t);
    if (!r) return carte(cls, 'fa-person-running', 'À dépasser', '', '<p class="vide">Classement d\'équipe indisponible.</p>');
    const nom = (x) => esc(sansFtth(x.login));
    const corps = r.rang === 1
      ? `<div class="gros num">1<sup>er</sup></div><p><b>Vous êtes en tête de votre équipe !</b></p>${r.suivant ? `<p class="pousse note">${nom(r.suivant)} (2<sup>e</sup>) ${r.avance ? 'est à <b>' + pluriel(r.avance, 'vente') + '</b> de vous dépasser' : 'vous suit'} : gardez le rythme.</p>` : ''}`
      : r.manque
        ? `<div class="gros num">${n(r.manque)} <small>vente${r.manque > 1 ? 's' : ''}</small></div><p>pour dépasser <b>${nom(r.devant)}</b> et passer ${rangTxt(r.rang - 1)} de l'équipe.</p>${r.manquePremier ? `<p class="pousse note">Et <b>${pluriel(r.manquePremier, 'vente')}</b> pour prendre la 1<sup>re</sup> place (${nom(r.premier)}).</p>` : ''}`
        : '<p class="vide">Pas d\'objectif ce mois-ci : pas de classement.</p>';
    return carte(cls + ' defi', 'fa-person-running', 'À dépasser', 'Vous êtes ' + rangTxt(r.rang) + ' sur ' + r.sur + ' dans l\'équipe', corps);
  }

  /* Ma journée : ventes à faire pour une journée réussie (objectif du jour) et ce que ça rapporte */
  function carteJournee(t, cls) {
    const j = t.moi.jour, mo = t.moi.mois, prime = mo && mo.primes.eligible ? mo.primes.prime_journee : 0, quand = 'Le ' + court(j.date);
    if (!j.objectif) return carte(cls, 'fa-sun', 'Ma journée', quand, `<div class="centre-v gauche"><div class="gros num">${n(j.ventes)} <small>vente${j.ventes > 1 ? 's' : ''}</small></div><p class="note">Jour non ouvré ou sans objectif : chaque vente compte quand même pour le mois.</p></div>`);
    const reste = Math.max(0, Math.ceil(j.objectif - 1e-9) - j.ventes);
    return carte(cls + ' defi', 'fa-sun', 'Ma journée', quand + ' · objectif ' + dec(j.objectif),
      reste > 0 ? `<div class="centre-v gauche"><div class="gros num">${n(reste)} <small>vente${reste > 1 ? 's' : ''}</small></div><p>pour réussir la journée (${n(j.ventes)} faite${j.ventes > 1 ? 's' : ''}).</p>${prime ? `<p class="note">Journée réussie = <b>+${fcfa(prime)}</b> de prime.</p>` : ''}</div>`
        : `<div class="centre-v gauche"><div class="gros"><i class="fa-solid fa-circle-check" style="color:var(--pos)"></i></div><p><b>Journée réussie !</b> ${n(j.ventes)} vente${j.ventes > 1 ? 's' : ''} pour un objectif de ${dec(j.objectif)}.</p>${prime ? `<p class="note"><b>+${fcfa(prime)}</b> de prime gagnée ce jour-là.</p>` : ''}</div>`);
  }

  /* ---------- Tableau de bord : l'essentiel, chaque détail a sa page dans le menu ---------- */
  function vueAccueil(t) {
    const m = t.moi, mo = m.mois, per = m.periode, fin = court(t.periode.au), lib = moisLong(t.periode.au);
    const etiquette = !mo || mo.obj_a_date <= 0 ? '' : mo.ecart >= 0
      ? `<span class="etiquette pos"><i class="fa-solid fa-arrow-trend-up"></i> En avance de ${pluriel(mo.ecart, 'vente')}</span>`
      : `<span class="etiquette neg"><i class="fa-solid fa-arrow-trend-down"></i> ${pluriel(-mo.ecart, 'vente')} de retard</span>`;
    let h = mo && mo.objectif
      ? `<section class="carte heros c-8">${anneau(mo.tro, "de l'objectif")}<div style="min-width:0"><h2>Objectif de ${esc(lib)}</h2>
          <div class="grand num">${n(mo.ventes)} / ${n(mo.objectif)} ventes</div>
          <small>Attendu au ${fin} : ${n(mo.obj_a_date)} · reste ${n(mo.reste)} · ${mo.ouvres_ecoules}/${mo.ouvres_mois} jours ouvrés</small><br>${etiquette}
          <div class="message">${encouragement(t)}</div></div></section>`
      : `<section class="carte heros c-8"><div><h2>${pluriel(per.ventes, 'vente validée')}</h2><small>Aucun objectif enregistré pour vous en ${esc(lib)}. Rapprochez-vous de votre superviseur.</small></div></section>`;
    h += carteJournee(t, 'c-4');
    h += tuile('fa-cart-shopping', 'Ventes de la période', per.ventes, per.objectif, n(per.b2c) + ' B2C · ' + n(per.b2b) + ' B2B')
      + tuile('fa-calendar-week', 'Cette semaine', m.semaine.ventes, m.semaine.objectif, 'Depuis le ' + court(m.semaine.depuis))
      + `<div class="tuile c-3"><div class="t"><i class="fa-solid fa-ranking-star"></i>Mon classement</div><div class="v num">${m.rang.equipe ? rangTxt(m.rang.equipe) : '—'} <small>/ ${n(m.rang.sur_equipe)}</small></div><div class="a">dans l'équipe · ${m.rang.reseau ? rangTxt(m.rang.reseau) : '—'} sur ${n(m.rang.sur_reseau)} RGZ</div></div>`
      + `<div class="tuile c-3"><div class="t"><i class="fa-solid fa-coins"></i>Primes estimées</div><div class="v num" style="font-size:1.3rem">${mo && mo.primes.eligible ? fcfa(mo.primes.total) : '—'}</div><div class="a">${mo && mo.primes.palier ? 'Palier « ' + esc(mo.primes.palier) + ' »' : 'Détail dans « Mes primes »'}</div></div>`;
    h += carteDefi(t, 'c-4') + carteDepasser(t, 'c-4') + cartePalier(t, 'c-4');
    const compare = carteMoisPrecedent(t, 'c-6');   // vide si la base n'a pas le mois précédent : le champion prend alors toute la ligne
    h += carteChampionEquipe(t, compare ? 'c-6' : 'c-12') + compare;
    return h;
  }

  function carteDefi(t, cls) {
    const pj = t.motivation.projection;
    return pj ? carte('defi ' + cls, 'fa-bullseye', 'Mon défi', 'Pour atteindre l\'objectif du mois',
      pj.reste > 0 ? `<div class="gros num">${n(pj.par_jour)} <small>vente${pj.par_jour > 1 ? 's' : ''} / jour</small></div>
        <p>sur les <b>${pj.ouvres_restants}</b> jours ouvrés restants (${pluriel(pj.reste, 'vente')} à faire).</p>
        <p class="pousse note">À votre rythme actuel (${dec(pj.rythme)} / jour), vous finirez à <b>${n(pj.fin_de_mois)} ventes</b> (${pct(pj.tro)})${pj.palier ? ', palier « ' + esc(pj.palier) + ' »' : ''}.</p>`
        : `<div class="gros"><i class="fa-solid fa-flag-checkered" style="color:var(--pos)"></i></div><p><b>Objectif atteint !</b> À ce rythme : ${n(pj.fin_de_mois)} ventes en fin de mois${pj.palier ? ', palier « ' + esc(pj.palier) + ' »' : ''}.</p>`)
      : carte(cls, 'fa-bullseye', 'Mon défi', '', '<p class="vide">Pas d\'objectif ce mois-ci.</p>');
  }
  function cartePalier(t, cls) {
    const mo = t.moi.mois, suivant = mo && mo.primes.suivant;
    return carte(cls, 'fa-stairs', 'Prochain palier', mo && mo.primes.palier ? 'Palier actuel : « ' + esc(mo.primes.palier) + ' »' : 'Aucun palier atteint pour l\'instant',
      suivant ? `<div class="centre-v gauche"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>« ${esc(suivant.nom)} »</b><b class="num" style="color:var(--pos-text)">+${fcfa(suivant.prime)}</b></div>
        ${barre(mo.ventes / Math.max(1, mo.ventes + suivant.manque), 'ambre')}<p class="note">Encore <b>${pluriel(suivant.manque, 'vente')}</b> pour le décrocher.</p></div>`
        : `<p class="centre-v gauche">${mo && mo.primes.eligible ? '<b>Tous les paliers sont atteints, bravo !</b>' : 'Primes non applicables à votre compte ce mois-ci.'}</p>`);
  }

  /* ---------- Mes résultats › Mon mois jour par jour ---------- */
  function vueMonMois(t) {
    const m = t.moi, per = m.periode, mv = t.motivation;
    let h = tuile('fa-calendar-day', 'Le ' + court(m.jour.date), m.jour.ventes, m.jour.objectif, m.jour.objectif ? 'Objectif du jour' : 'Jour non ouvré ou sans objectif')
      + tuile('fa-calendar-check', 'Journées réussies', m.mois ? m.mois.primes.journees : 0, null, 'Objectif du jour atteint ce mois-ci')
      + tuile('fa-trophy', 'Mon record', mv.record ? mv.record.ventes : 0, null, mv.record ? 'Le ' + court(mv.record.jour) : 'Pas encore de vente ce mois-ci')
      + tuile('fa-bolt', 'Série en cours', mv.serie_vente, null, 'jour' + (mv.serie_vente > 1 ? 's' : '') + ' ouvré' + (mv.serie_vente > 1 ? 's' : '') + ' d\'affilée avec vente');
    h += carte('c-8', 'fa-chart-column', 'Mes ventes jour par jour', 'Ventes validées de la période (en vert : objectif du jour atteint)', '<div class="graphe remplit"><canvas id="g-jours"></canvas></div>');
    graphe('g-jours', (css) => ({ data: { labels: per.jours.map((j) => jourCourt(j.jour)), datasets: [
      { type: 'bar', label: 'Ventes validées', data: per.jours.map((j) => j.ventes), backgroundColor: per.jours.map((j) => (j.objectif && j.ventes >= j.objectif ? css('--pos') : css('--primary-600'))), borderRadius: 4, maxBarThickness: 28 },
      { type: 'line', label: 'Objectif du jour', data: per.jours.map((j) => j.objectif), borderColor: css('--warn'), borderDash: [5, 4], pointRadius: 0, borderWidth: 2 },
    ] }, options: optionsBarres }));
    return h + calendrier(t, 'c-4') + carteMoisPrecedent(t, 'c-12');
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
      <div class="legende"><span style="--c:var(--pos)">Réussie</span><span style="--c:var(--primary-soft)">Avec ventes</span><span style="--c:var(--surface-2)">Sans vente</span></div>`);
  }

  function championCarte(t, cls) {
    const ch = t.motivation.champion;
    return carte(cls, 'fa-crown', 'Champion RGZ du jour', ch ? 'Meilleur taux de réalisation le ' + court(ch.jour) : '',
      ch ? `<div class="champion centre-v gauche"><span class="couronne"><i class="fa-solid fa-crown"></i></span><span><b>${ch.moi ? 'C\'est vous !' : esc(sansFtth(ch.login))}</b>
        <small>Équipe ${esc(ch.equipe)} · ${pluriel(ch.ventes, 'vente')} ce jour-là</small></span></div><p class="note">Chaque jour, le meilleur commercial RGZ gagne la prime « champion du jour ». Pourquoi pas vous ?</p>`
        : '<p class="vide">Pas encore de champion ce mois-ci : la place est à prendre !</p>');
  }

  /* ---------- Mes résultats › Ventes B2C / B2B ---------- */
  function vueVentes(t) {
    const per = t.moi.periode, mo = t.moi.mois, ok = t.ventes.filter((v) => v.compte);
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
        ${mo.primes.bonus_b2b_possible ? `<p class="note">${mo.primes.bonus_b2b ? '<b>Bonus B2B gagné :</b> ' + fcfa(mo.primes.bonus_b2b) : 'Atteignez l\'objectif B2B pour gagner un bonus de <b>' + fcfa(mo.primes.bonus_b2b_possible) + '</b>.'}</p>` : ''}</div>`)
      : carte('c-4 t-6', 'fa-flag-checkered', 'Objectifs par segment', '', '<p class="vide">Pas d\'objectif ce mois-ci.</p>');
    const offres = {}; ok.forEach((v) => { offres[v.offre || '—'] = (offres[v.offre || '—'] || 0) + 1; });
    const top = Object.entries(offres).sort((a, b) => b[1] - a[1]).slice(0, 5);
    h += carte('c-4', 'fa-box-open', 'Mes offres les plus vendues', 'Ventes validées de la période', top.length ? `<ul class="classement">${top.map(([o, c], i) =>
      `<li><span class="pos">${i + 1}</span><span class="nom"><b title="${esc(o)}">${esc(o)}</b>${barre(c / top[0][1], 'bleu')}</span><span class="val num">${n(c)}</span></li>`).join('')}</ul>` : '<p class="vide">Aucune vente validée sur la période.</p>');
    return h;
  }

  /* ---------- Mes résultats › Détail de mes ventes ---------- */
  function vueDetail(t) {
    const V = t.ventes, nb = (f) => V.filter(f).length;
    const h = tuile('fa-list', 'Ventes de la période', V.length, null, V.length >= 500 ? '500 plus récentes affichées' : 'Validées et en attente')
      + tuile('fa-circle-check', 'Validées', nb((v) => v.compte), null, 'Comptent pour vos objectifs')
      + tuile('fa-hourglass-half', 'En attente', nb((v) => !v.compte), null, 'Pas encore validées')
      + `<div class="tuile c-3"><div class="t"><i class="fa-solid fa-coins"></i>Montant validé</div><div class="v num" style="font-size:1.3rem">${fcfa(V.filter((v) => v.compte).reduce((s, v) => s + v.montant, 0))}</div><div class="a">Sur la période</div></div>`
      + carte('c-12', 'fa-list-check', 'Détail de mes ventes', V.length >= 500 ? '500 ventes les plus récentes de la période' : pluriel(V.length, 'vente') + ' sur la période',
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

  /* ---------- Mon équipe (totaux et classements, aucune vente détaillée des collègues) ---------- */
  function herosEquipe(t, cls) {
    const eq = t.equipe, fin = court(t.periode.au), lib = moisLong(t.periode.au), ecart = eq.mois.ventes - eq.mois.obj_a_date;
    return `<section class="carte heros ${cls}">${anneau(eq.mois.tro, 'objectif équipe')}<div style="min-width:0"><h2>Équipe ${esc(eq.nom || '—')}</h2>
      <div class="grand num">${n(eq.mois.ventes)} / ${n(eq.mois.objectif)} ventes</div>
      <small>${esc(lib)} · attendu au ${fin} : ${n(eq.mois.obj_a_date)} · ${pluriel(eq.membres.length, 'membre')}</small><br>
      ${eq.mois.obj_a_date > 0 ? `<span class="etiquette ${ecart >= 0 ? 'pos' : 'neg'}">${ecart >= 0 ? 'En avance de ' + pluriel(ecart, 'vente') : pluriel(-ecart, 'vente') + ' de retard'}</span>` : ''}
      ${eq.rang ? `<span class="etiquette neutre"><i class="fa-solid fa-ranking-star"></i> ${eq.rang === 1 ? '1re' : eq.rang + 'e'} équipe sur ${eq.nb_equipes}</span>` : ''}</div></section>`;
  }
  function vueEquipe(t) {
    const eq = t.equipe, mo = t.moi.mois, fin = court(t.periode.au), lib = moisLong(t.periode.au);
    let h = herosEquipe(t, 'c-8') + carteDepasser(t, 'c-4');
    h += carte('c-8', 'fa-people-group', 'Classement de l\'équipe', esc(lib) + ', au ' + fin + ' · taux de réalisation', `<ul class="classement">${eq.membres.map((x, i) => `<li class="${x.moi ? 'moi' : ''}"><span class="pos">${i + 1}</span>
      <span class="nom"><b>${esc(sansFtth(x.login))}${x.moi ? ' (moi)' : ''}</b><small>${n(x.ventes_mois)} / ${n(x.objectif)} ce mois · ${n(x.ventes_periode)} sur la période</small>${barre(x.tro)}</span>
      <span class="val num">${x.objectif ? pct(x.tro) : '—'}</span></li>`).join('') || '<li class="vide">Aucun membre.</li>'}</ul>`);
    // Contenu centré dans la hauteur de la carte (alignée sur le classement, plus haut) : aucun vide en haut ni en bas
    const mesVentes = mo ? mo.ventes : 0, ecartMoy = mesVentes - eq.moyenne;
    h += carte('c-4', 'fa-hand-holding-heart', 'Ma contribution', 'Ma part des ventes de l\'équipe ce mois-ci', eq.ma_part != null
      ? `<div class="centre-v">${anneau(eq.ma_part, 'des ventes', true)}
        <div class="faits"><div class="fait"><b class="num">${n(mesVentes)}</b><small>mes ventes</small></div>
          <div class="fait"><b class="num">${dec(eq.moyenne)}</b><small>moyenne par membre</small></div>
          <div class="fait"><b class="num" style="color:var(${ecartMoy >= 0 ? '--pos-text' : '--neg-text'})">${ecartMoy >= 0 ? '+' : '−'}${dec(Math.round(Math.abs(ecartMoy) * 10) / 10)}</b><small>par rapport à la moyenne</small></div></div>
        <p class="note">${ecartMoy >= 0 ? '<b>Vous tirez l\'équipe vers le haut</b> : continuez !' : 'Encore <b>' + pluriel(Math.ceil(-ecartMoy - 1e-9), 'vente') + '</b> pour atteindre la moyenne de l\'équipe.'}</p></div>`
      : '<p class="vide">Pas encore de ventes dans l\'équipe.</p>');
    return h;
  }
  function vueEquipeEvolution(t) {
    const eq = t.equipe, fin = court(t.periode.au), lib = moisLong(t.periode.au), jours = eq.jours.filter((j) => j.ventes > 0);
    const meilleur = jours.reduce((b, j) => (!b || j.ventes > b.ventes ? j : b), null);
    let h = tuile('fa-people-group', 'Ventes de l\'équipe', eq.mois.ventes, eq.mois.objectif, esc(lib))
      + tuile('fa-flag-checkered', 'Attendu au ' + fin, eq.mois.obj_a_date, null, eq.mois.ventes >= eq.mois.obj_a_date ? 'L\'équipe est dans les temps' : 'Il manque ' + pluriel(eq.mois.obj_a_date - eq.mois.ventes, 'vente'))
      + tuile('fa-trophy', 'Meilleur jour', meilleur ? meilleur.ventes : 0, null, meilleur ? 'Le ' + court(meilleur.jour) : 'Pas encore de vente')
      + tuile('fa-ranking-star', 'Rang de l\'équipe', eq.rang || 0, null, eq.rang ? 'sur ' + eq.nb_equipes + ' équipes RGZ' : '—');
    h += carte('c-12', 'fa-chart-line', 'Ventes de l\'équipe jour par jour', esc(lib) + ', du 1<sup>er</sup> au ' + fin, '<div class="graphe remplit"><canvas id="g-equipe"></canvas></div>');
    const objJ = eq.mois.obj_a_date && t.calendrier.ouvres_ecoules ? eq.mois.obj_a_date / t.calendrier.ouvres_ecoules : null;
    const ouvres = new Set(t.motivation.calendrier.filter((c) => c.ouvre).map((c) => c.jour));
    graphe('g-equipe', (css) => ({ data: { labels: eq.jours.map((j) => jourCourt(j.jour)), datasets: [
      { type: 'bar', label: 'Ventes de l\'équipe', data: eq.jours.map((j) => j.ventes), backgroundColor: css('--primary-600'), borderRadius: 4, maxBarThickness: 28 },
      ...(objJ ? [{ type: 'line', label: 'Objectif d\'équipe par jour', data: eq.jours.map((j) => (ouvres.has(j.jour) ? Math.round(objJ * 10) / 10 : null)), borderColor: css('--warn'), borderDash: [5, 4], pointRadius: 0, borderWidth: 2 }] : []),
    ] }, options: optionsBarres }));
    return h;
  }
  function vueEquipes(t) {
    const fin = court(t.periode.au), lib = moisLong(t.periode.au), eq = t.equipe;
    const devant = eq.rang > 1 ? t.equipes[eq.rang - 2] : null;
    return herosEquipe(t, 'c-12')
      + carte('c-12', 'fa-flag', 'Classement des équipes RGZ', 'Taux de réalisation de l\'objectif d\'équipe · ' + esc(lib) + ', au ' + fin
        + (devant ? ' · équipe juste devant : <b>' + esc(devant.nom) + '</b> (' + pct(devant.tro) + ')' : eq.rang === 1 ? ' · <b>votre équipe est en tête !</b>' : ''),
      `<ul class="classement deux">${t.equipes.map((e, i) => `<li class="${e.moi ? 'moi' : ''}"><span class="pos">${i + 1}</span>
      <span class="nom"><b>${esc(e.nom)}${e.moi ? ' (mon équipe)' : ''}</b><small>${n(e.ventes)} / ${n(e.objectif)} ventes · ${pluriel(e.membres, 'membre')}</small>${barre(e.tro)}</span>
      <span class="val num">${e.objectif ? pct(e.tro) : '—'}</span></li>`).join('')}</ul>`);
  }
  function vueChampion(t) {
    const mo = t.moi.mois, pr = mo && mo.primes;
    return carteChampionEquipe(t, 'c-6') + championCarte(t, 'c-6') + carteHonneur(t, 'c-6')
      + carte('c-6', 'fa-medal', 'Mes titres ce mois-ci', 'Champion RGZ (prime) et champion de l\'équipe', `<div class="faits" style="margin-top:0">
        <div class="fait"><b class="num">${n(pr ? pr.champion : 0)}</b><small>fois champion</small></div>
        <div class="fait"><b class="num">${pr && pr.eligible ? fcfa(pr.prime_champion) : '—'}</b><small>gagnés</small></div>
        <div class="fait"><b class="num">${n(t.champion_equipe ? t.champion_equipe.mes_titres : 0)}</b><small>fois champion de l'équipe</small></div></div>`)
      + carte('c-12', 'fa-circle-question', 'Comment devenir champion du jour', '', `<ol class="etapes">
        <li><b>Atteignez votre objectif du jour</b> : seuls ceux qui l'atteignent peuvent être champion.</li>
        <li><b>Dépassez-le le plus possible</b> : le champion est celui qui a le meilleur pourcentage de son objectif du jour.</li>
        <li>À égalité de pourcentage, celui qui a fait <b>le plus de ventes</b> l'emporte.</li></ol>
        <p class="note">Même règle pour le champion de l'équipe (entre les membres de l'équipe) et pour le champion RGZ (entre tous les commerciaux RGZ, avec la prime « champion du jour »).</p>`);
  }

  /* ---------- Primes & défis ---------- */
  const sansPrimes = (t) => carte('c-12', 'fa-trophy', 'Primes & défis', '', '<p class="vide">Les primes ne s\'appliquent pas à votre compte ce mois-ci (pas d\'objectif enregistré).</p>');
  function vuePrimes(t) {
    const mo = t.moi.mois, pj = t.motivation.projection, lib = moisLong(t.periode.au), fin = court(t.periode.au);
    if (!mo || !mo.primes.eligible) return sansPrimes(t);
    const pr = mo.primes;
    return `<section class="carte total-primes c-4"><h2 style="justify-content:center"><i class="fa-solid fa-coins"></i>Primes estimées</h2><p class="sous">${esc(lib)}, du 1<sup>er</sup> au ${fin}</p>
      <div class="gros num">${fcfa(pr.total)}</div>${pj && pj.prime_palier > pr.prime_palier ? `<p class="note">À votre rythme, le palier « ${esc(pj.palier)} » (${fcfa(pj.prime_palier)}) est à votre portée d'ici la fin du mois !</p>` : ''}
      <p class="note">Estimation selon les règles du mois ; le montant final est validé par la direction.</p></section>`
      + carte('c-8', 'fa-receipt', 'Détail de mes primes', '', `<ul class="lignes">
      <li><span>Palier du mois<small>${pr.palier ? '« ' + esc(pr.palier) + ' » atteint' : 'Aucun palier atteint pour l\'instant'}</small></span><b>${fcfa(pr.prime_palier)}</b></li>
      <li><span>Journées réussies<small>${n(pr.journees)} × ${fcfa(pr.prime_journee)} (objectif du jour atteint)</small></span><b>${fcfa(pr.prime_journees)}</b></li>
      <li><span>Champion du jour<small>${n(pr.champion)} fois meilleur commercial RGZ du jour</small></span><b>${fcfa(pr.prime_champion)}</b></li>
      ${pr.bonus_b2b_possible ? `<li><span>Bonus B2B<small>${pr.bonus_b2b ? 'Objectif B2B atteint' : n(mo.b2b) + ' / ' + n(mo.obj_b2b) + ' ventes B2B'}</small></span><b>${fcfa(pr.bonus_b2b)}</b></li>` : ''}
      <li><span><b>Total estimé</b></span><b style="color:var(--pos-text)">${fcfa(pr.total)}</b></li></ul>`)
      + carteJournee(t, 'c-4') + cartePalier(t, 'c-4') + championCarte(t, 'c-4');
  }
  function vuePaliers(t) {
    const mo = t.moi.mois, mv = t.motivation;
    if (!mo || !mo.primes.eligible) return sansPrimes(t);
    const suiv = mv.paliers.find((p) => !p.atteint);
    return carte('c-12', 'fa-stairs', 'Échelle des paliers', 'Votre TRO du mois : ' + pct(mo.tro) + ' (' + n(mo.ventes) + ' / ' + n(mo.objectif) + ' ventes)', `<div class="echelle">${mv.paliers.map((p) => {
      const manque = p.ventes != null ? Math.max(0, p.ventes - mo.ventes) : null;
      return `<div class="palier ${p.atteint ? 'atteint' : p === suiv ? 'suivant' : ''}"><span class="ic"><i class="fa-solid ${p.atteint ? 'fa-check' : p === suiv ? 'fa-person-running' : 'fa-lock'}"></i></span>
        <span><b>${esc(p.nom)} · ${pct(p.seuil)}</b><small>${p.ventes != null ? n(p.ventes) + ' ventes' : ''}${p.atteint ? ' · atteint' : manque ? ' · encore ' + pluriel(manque, 'vente') : ''}</small>${barre(p.ventes ? mo.ventes / p.ventes : 0, p.atteint ? '' : 'ambre')}</span>
        <span class="prime num">${fcfa(p.prime)}</span></div>`;
    }).join('')}</div>`);
  }
  function vueProjection(t) {
    const mo = t.moi.mois, pj = t.motivation.projection;
    if (!mo || !pj) return carte('c-12', 'fa-rocket', 'Projection de fin de mois', '', '<p class="vide">Projection indisponible (pas d\'objectif ce mois-ci).</p>');
    return carte('c-8', 'fa-rocket', 'Projection de fin de mois', 'Si vous gardez votre rythme actuel', `<div class="faits" style="margin-top:0">
        <div class="fait"><b class="num">${dec(pj.rythme)}</b><small>ventes / jour ouvré</small></div>
        <div class="fait"><b class="num">${n(pj.fin_de_mois)}</b><small>ventes fin de mois</small></div>
        <div class="fait"><b class="num">${pct(pj.tro)}</b><small>TRO projeté</small></div></div>
        <div class="projbar" role="img" aria-label="Réalisé ${n(mo.ventes)}, projeté ${n(pj.fin_de_mois)}, objectif ${n(mo.objectif)}">
          <span class="proj" style="width:${Math.min(100, pj.fin_de_mois / Math.max(mo.objectif, pj.fin_de_mois) * 100)}%"></span><span class="real" style="width:${Math.min(100, mo.ventes / Math.max(mo.objectif, pj.fin_de_mois) * 100)}%"></span></div>
        <div class="projbar-leg"><span>Réalisé <b>${n(mo.ventes)}</b></span><span>Projeté <b>${n(pj.fin_de_mois)}</b></span><span>Objectif <b>${n(mo.objectif)}</b></span></div>
        <p class="note pousse" style="font-size:.8rem">${pj.reste > 0 ? `Pour atteindre <b>100 %</b>, il faut <b>${pluriel(pj.par_jour, 'vente')} par jour</b> sur les ${pj.ouvres_restants} jours ouvrés restants.` : '<b>Objectif atteint !</b> Visez maintenant le palier supérieur.'}
        ${pj.palier ? ' Palier projeté : <b>« ' + esc(pj.palier) + ' »</b> (' + fcfa(pj.prime_palier) + ').' : ''}</p>`)
      + carteDefi(t, 'c-4');
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
      `<div class="badge-s${ok ? ' gagne' : ''}"><i class="fa-solid ${ok ? ic : 'fa-lock'}"></i><b>${esc(nom)}</b><small>${ok ? 'Débloqué' : esc(aide)}</small></div>`).join('')}</div>`);
  }

  /* ---------- Accueil : champion du jour de l'équipe (félicitations si c'est lui, sinon de quoi lui donner envie) ---------- */
  function annonceChampion(t) {
    const ce = t.champion_equipe, a = ce && ce.annonce;
    if (!a) return;
    const ch = a.champion, moi = a.moi, quand = court(a.jour), equipe = esc(t.agent.equipe || '');
    const objMoi = moi.objectif ? Math.ceil(moi.objectif - 1e-9) : null;
    let ic, titre, corps;
    if (ch && ch.moi) {
      ic = 'fa-crown'; titre = 'Félicitations, champion&nbsp;!';
      corps = `<p class="grand-txt">Vous êtes <b>le champion du jour de l'équipe ${equipe}</b> (${quand})&nbsp;!</p>
        <div class="chiffres"><div><b class="num">${n(ch.ventes)}</b><small>ventes</small></div><div><b class="num">${pct(ch.taux)}</b><small>de votre objectif du jour</small></div><div><b class="num">${n(ce.mes_titres)}</b><small>titre${ce.mes_titres > 1 ? 's' : ''} ce mois-ci</small></div></div>
        ${ch.aussi_rgz ? '<p class="bonus"><i class="fa-solid fa-star"></i> Et vous êtes aussi <b>le champion de tout RGZ</b> ce jour-là&nbsp;!</p>' : ''}
        <p>Bravo pour vos efforts ! Gardez ce rythme : réussissez aussi votre prochaine journée pour garder votre titre et rapprocher votre équipe de son objectif.</p>`;
    } else if (ch) {
      ic = 'fa-trophy'; titre = 'Champion du jour de votre équipe';
      corps = `<p class="grand-txt">Bravo à <b>${esc(sansFtth(ch.login))}</b>, champion de l'équipe ${equipe} (${quand})&nbsp;!</p>
        <div class="chiffres"><div><b class="num">${n(ch.ventes)}</b><small>ventes</small></div><div><b class="num">${pct(ch.taux)}</b><small>de son objectif du jour</small></div><div><b class="num">${n(moi.ventes)}</b><small>vos ventes ce jour-là</small></div></div>
        <p>${conseilChallenger(ch, moi, objMoi)}</p>`;
    } else {
      ic = 'fa-flag'; titre = 'La place de champion est libre';
      corps = `<p class="grand-txt">Le ${quand.replace(/\.$/, '')}, personne dans l'équipe ${equipe} n'a atteint son objectif du jour.</p>
        <p>${objMoi ? `<b>Prenez la place !</b> Atteignez votre objectif du jour (<b>${pluriel(objMoi, 'vente')}</b>) et vous pouvez devenir le champion de votre équipe.` : 'Chaque vente compte : soyez le premier de l\'équipe à réussir sa journée !'}</p>`;
    }
    const voile = document.createElement('div');
    voile.className = 'annonce' + (ch && ch.moi ? ' gagnant' : ''); voile.setAttribute('role', 'dialog'); voile.setAttribute('aria-modal', 'true'); voile.setAttribute('aria-labelledby', 'annonce-titre');
    voile.innerHTML = `<div class="boite"><span class="ic"><i class="fa-solid ${ic}" aria-hidden="true"></i></span><h2 id="annonce-titre">${titre}</h2>${corps}
      <button type="button" class="ok">Voir mes résultats <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button></div>${ch && ch.moi ? '<div class="confettis" aria-hidden="true"></div>' : ''}`;
    document.body.appendChild(voile);
    const arreter = ch ? feuArtifice(voile, ch.moi ? 5200 : 3200, ch.moi ? 1 : 0.55) : () => {};   // champion : fête ; plus grande si c'est lui
    const fermer = () => { arreter(); voile.remove(); document.removeEventListener('keydown', echap); };
    const echap = (e) => { if (e.key === 'Escape') fermer(); };
    voile.querySelector('.ok').addEventListener('click', fermer);
    voile.addEventListener('click', (e) => { if (e.target === voile) fermer(); });
    document.addEventListener('keydown', echap);
    voile.querySelector('.ok').focus();
    const conf = voile.querySelector('.confettis');
    if (conf && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const couleurs = ['#2450D3', '#12A672', '#F2A007', '#E5484D', '#7FA6FF'];
      for (let i = 0; i < 50; i++) { const c = document.createElement('i'); c.style.left = Math.random() * 100 + '%'; c.style.background = couleurs[i % couleurs.length]; c.style.animationDuration = 2.4 + Math.random() * 2 + 's'; c.style.animationDelay = Math.random() * .8 + 's'; conf.appendChild(c); }
    }
  }

  /* Feu d'artifice (canvas, sans bibliothèque) derrière le message d'accueil : fusées qui montent et éclatent en étincelles.
     duree : temps pendant lequel de nouvelles fusées partent ; force : nombre de fusées et d'étincelles (0 à 1).
     Rien si le téléphone demande moins d'animations. Renvoie la fonction qui arrête tout (fermeture du message). */
  function feuArtifice(parent, duree, force) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    if (!ctx) return () => {};
    cv.className = 'feu'; cv.setAttribute('aria-hidden', 'true'); parent.prepend(cv);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const taille = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    taille(); window.addEventListener('resize', taille);
    const couleurs = ['#FFD27A', '#F2A007', '#7FA6FF', '#2450D3', '#12A672', '#E5484D', '#FFFFFF'];
    const fusees = [], etincelles = [], cadence = 520 - 260 * force;
    let debut = performance.now();
    let derniere = -1e9, fin = false, raf = 0;
    const lancer = () => fusees.push({ x: innerWidth * (0.15 + Math.random() * 0.7), y: innerHeight + 10, vx: (Math.random() - 0.5) * 1.2,
      vy: -(innerHeight / 90) * (0.85 + Math.random() * 0.35), c: couleurs[Math.floor(Math.random() * couleurs.length)] });
    const eclater = (f) => {
      const n = Math.round(40 + 50 * force), c2 = Math.random() < 0.5 ? f.c : couleurs[Math.floor(Math.random() * couleurs.length)];
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n, v = 1.5 + Math.random() * 3.2;
        etincelles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vie: 1, c: i % 3 ? f.c : c2 });
      }
    };
    const image = () => {
      if (fin) return;
      const t = performance.now();   // même horloge que « debut » (l'heure fournie par requestAnimationFrame peut en différer)
      if (t - debut < duree && t - derniere > cadence) { derniere = t; lancer(); if (force > 0.8 && Math.random() < 0.4) lancer(); }
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(0, 0, innerWidth, innerHeight);   // traînées qui s'effacent
      ctx.globalCompositeOperation = 'lighter';
      for (let i = fusees.length - 1; i >= 0; i--) {
        const f = fusees[i]; f.x += f.vx; f.y += f.vy; f.vy += 0.12;
        ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, 2.2, 0, Math.PI * 2); ctx.fill();
        if (f.vy >= -1) { eclater(f); fusees.splice(i, 1); }   // sommet de la course : éclatement
      }
      for (let i = etincelles.length - 1; i >= 0; i--) {
        const e = etincelles[i]; e.x += e.vx; e.y += e.vy; e.vx *= 0.985; e.vy = e.vy * 0.985 + 0.05; e.vie -= 0.014;
        if (e.vie <= 0) { etincelles.splice(i, 1); continue; }
        ctx.globalAlpha = e.vie; ctx.fillStyle = e.c; ctx.beginPath(); ctx.arc(e.x, e.y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (t - debut > duree && !fusees.length && !etincelles.length) { arreter(); return; }
      raf = requestAnimationFrame(image);
    };
    const arreter = () => { if (fin) return; fin = true; cancelAnimationFrame(raf); window.removeEventListener('resize', taille); cv.remove(); };
    // Départ après l'apparition du message (0,45 s) : la boîte s'affiche d'abord, les fusées partent ensuite
    const depart = setTimeout(() => { if (!fin) { debut = performance.now(); raf = requestAnimationFrame(image); } }, 450);
    const securite = setTimeout(arreter, duree + 4500);   // arrêt garanti, même si l'onglet est en arrière-plan
    return () => { clearTimeout(depart); clearTimeout(securite); arreter(); };
  }

  /* Message au commercial qui n'a pas le titre : objectif atteint (il lui manquait peu) ou pas encore */
  function conseilChallenger(ch, moi, objMoi) {
    if (!objMoi) return 'Chaque vente compte : à vous de jouer pour la prochaine journée&nbsp;!';
    if (moi.ventes + 1e-9 >= moi.objectif) {
      // Même règle que le titre : meilleur pourcentage, puis plus de ventes à égalité
      let v = moi.ventes + 1;
      while (v < moi.ventes + 1000 && !(v / moi.objectif > ch.taux + 1e-9 || (Math.abs(v / moi.objectif - ch.taux) <= 1e-9 && v > ch.ventes))) v++;
      return `<b>Bravo, vous aussi avez réussi votre journée&nbsp;!</b> Il vous manquait <b>${pluriel(v - moi.ventes, 'vente')}</b> pour prendre le titre. La prochaine fois, c'est pour vous&nbsp;!`;
    }
    return `<b>La prochaine journée peut être la vôtre</b> : atteignez votre objectif du jour (<b>${pluriel(objMoi, 'vente')}</b>), puis dépassez-le le plus possible pour prendre sa place.`;
  }

  /* Champion du jour de l'équipe et tableau d'honneur (titres du mois) */
  function carteChampionEquipe(t, cls) {
    const ce = t.champion_equipe, a = ce && ce.annonce, ch = a && a.champion;
    return carte(cls, 'fa-trophy', 'Champion de mon équipe', a ? 'Dernier jour ouvré : ' + court(a.jour) : '',
      ch ? `<div class="champion centre-v gauche"><span class="couronne"><i class="fa-solid fa-trophy"></i></span><span><b>${ch.moi ? 'C\'est vous !' : esc(sansFtth(ch.login))}</b>
        <small>${pluriel(ch.ventes, 'vente')} · ${pct(ch.taux)} de son objectif du jour</small></span></div>`
        : '<p class="vide">Personne n\'a atteint son objectif ce jour-là : la place est libre !</p>');
  }
  function carteHonneur(t, cls) {
    const ce = t.champion_equipe, L = ce ? ce.honneur : [], max = Math.max(1, ...L.map((x) => x.titres));
    return carte(cls, 'fa-medal', 'Tableau d\'honneur de l\'équipe', 'Nombre de fois champion du jour de l\'équipe depuis le 1er du mois' + (ce ? ' (' + ce.jours_ouvres + ' jours ouvrés)' : ''),
      L.length ? `<ul class="classement">${L.map((x, i) => `<li class="${x.moi ? 'moi' : ''}"><span class="pos">${i + 1}</span>
        <span class="nom"><b>${esc(sansFtth(x.login))}${x.moi ? ' (moi)' : ''}</b>${barre(x.titres / max, 'ambre')}</span><span class="val num">${n(x.titres)}</span></li>`).join('')}</ul>`
        : '<p class="vide">Aucun membre.</p>');
  }

  /* Comparaison avec le mois précédent, à date égale */
  function carteMoisPrecedent(t, cls) {
    const mp = t.mois_precedent, mo = t.moi.mois;
    if (!mp || !mo) return '';
    const diff = mo.ventes - mp.ventes_a_date, nomMois = moisLong(mp.mois + '-01');
    return carte(cls, 'fa-scale-unbalanced', 'Par rapport au mois dernier', 'Du 1er au ' + (+t.periode.au.slice(8)) + ' : ce mois-ci et en ' + esc(nomMois), `<div class="faits" style="margin-top:0">
        <div class="fait"><b class="num">${n(mo.ventes)}</b><small>ventes ce mois-ci</small></div>
        <div class="fait"><b class="num">${n(mp.ventes_a_date)}</b><small>en ${esc(nomMois)} à la même date</small></div>
        <div class="fait"><b class="num" style="color:var(${diff >= 0 ? '--pos-text' : '--neg-text'})">${diff >= 0 ? '+' : '−'}${n(Math.abs(diff))}</b><small>d'écart</small></div></div>
      <p class="note">${diff > 0 ? '<b>Vous faites mieux que le mois dernier</b> : continuez sur cette lancée !' : diff === 0 ? 'Exactement comme le mois dernier : une vente de plus et vous faites mieux !' : 'Encore <b>' + pluriel(-diff + 1, 'vente') + '</b> pour faire mieux que le mois dernier à la même date.'} Mois dernier complet : <b>${pluriel(mp.ventes_mois, 'vente')}</b>.</p>`);
  }

  const PAGES = { accueil: vueAccueil, 'mon-mois': vueMonMois, ventes: vueVentes, detail: vueDetail, equipe: vueEquipe, 'equipe-evolution': vueEquipeEvolution,
    equipes: vueEquipes, champion: vueChampion, primes: vuePrimes, paliers: vuePaliers, projection: vueProjection, badges: badgesCarte };

  /* ---------- Déconnexion : confirmation Oui / Non ---------- */
  const formSortie = $('#form-sortie'), dlg = $('#confirm-sortie');
  if (formSortie && dlg) {
    formSortie.addEventListener('submit', (e) => { if (formSortie._ok) return; e.preventDefault(); menu(false); dlg.showModal ? dlg.showModal() : (formSortie._ok = true, formSortie.submit()); });
    dlg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { dlg.close(); if (b.value === 'oui') { formSortie._ok = true; formSortie.submit(); } }));
  }

  choisirVue();
  charger();
})();
