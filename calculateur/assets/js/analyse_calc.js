/* ============================================================================
   analyse_calc.js — calculs des pages d'analyse (Tableau de bord RGZ › Évolution, Comparaisons, Alertes, Prévisions).
   Fonctions PURES (aucun accès au DOM, au stockage ni au réseau) : navigateur (window.CT.analyseCalc) et Node (tests).
   Entrées : lignes déjà classées par le parseur { jour 'AAAA-MM-JJ', statut, partenaire, segment 'B2B'|'B2C', loginKey, login }.
   Règles communes :
     • une vente compte si son statut est dans `statuts` (Paramètres › Règles : « OK » par défaut) ;
     • réseau = ventes comptées de TOUS les partenaires ; PDM = ventes du partenaire ÷ réseau ;
     • ratio B2B = ventes B2B ÷ ventes du partenaire ;
     • semaines du lundi au dimanche, numérotées selon l'ISO 8601 (S41 = semaine 41).
   ========================================================================== */
(function (racine, fabrique) {
  'use strict';
  const api = fabrique();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { racine.CT = racine.CT || {}; racine.CT.analyseCalc = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Dates (chaînes AAAA-MM-JJ, calcul en UTC : pas de décalage horaire) ---------- */
  const versDate = (j) => new Date(Date.UTC(+j.slice(0, 4), +j.slice(5, 7) - 1, +j.slice(8, 10)));
  const versJour = (d) => d.toISOString().slice(0, 10);
  const ajouter = (j, n) => { const d = versDate(j); d.setUTCDate(d.getUTCDate() + n); return versJour(d); };
  const lundiDe = (j) => { const d = versDate(j), w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return versJour(d); };
  /** Semaine ISO 8601 : { annee, num } (la semaine appartient à l'année de son jeudi). */
  function semaineIso(j) {
    const d = versDate(j), w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w + 3);
    const annee = d.getUTCFullYear(), jan4 = new Date(Date.UTC(annee, 0, 4));
    return { annee, num: 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7) };
  }
  const finMois = (cle) => versJour(new Date(Date.UTC(+cle.slice(0, 4), +cle.slice(5, 7), 0)));
  const moisDecale = (cle, n) => { const d = new Date(Date.UTC(+cle.slice(0, 4), +cle.slice(5, 7) - 1 + n, 1)); return versJour(d).slice(0, 7); };
  const joursEntre = (du, au) => { const out = []; for (let j = du; j <= au; j = ajouter(j, 1)) out.push(j); return out; };
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const libMois = (cle) => { const m = MOIS[+cle.slice(5, 7) - 1]; return m.charAt(0).toUpperCase() + m.slice(1) + ' ' + cle.slice(0, 4); };
  const pct = (a, b) => (b > 0 ? a / b : null);
  const evol = (a, b) => (b > 0 ? (a - b) / b : null);   // variation relative de b vers a

  /* ---------- Comptage ---------- */
  /** Ventes comptées par jour : Map jour → { b2c, b2b, total (partenaire), reseau (tous partenaires) }. */
  function parJour(lignes, { partenaire, statuts = ['OK'], du = '0000-00-00', au = '9999-99-99' }) {
    const m = new Map();
    for (const l of lignes) {
      if (!l.jour || l.jour < du || l.jour > au || !statuts.includes(l.statut)) continue;
      let g = m.get(l.jour); if (!g) m.set(l.jour, (g = { b2c: 0, b2b: 0, total: 0, reseau: 0 }));
      g.reseau++;
      if (l.partenaire === partenaire) { g.total++; if (l.segment === 'B2B') g.b2b++; else g.b2c++; }
    }
    return m;
  }
  const vide = () => ({ b2c: 0, b2b: 0, total: 0, reseau: 0, jours: 0 });
  const cumuler = (acc, g) => { if (g) { acc.b2c += g.b2c; acc.b2b += g.b2b; acc.total += g.total; acc.reseau += g.reseau; } acc.jours++; return acc; };
  const finir = (g) => Object.assign(g, { ratioB2B: pct(g.b2b, g.total), pdm: pct(g.total, g.reseau) });
  /** Somme sur [du → au]. */
  function bilan(pj, du, au) { const g = vide(); joursEntre(du, au).forEach((j) => cumuler(g, pj.get(j))); return finir(g); }

  /**
   * Série chronologique sur [du → au] par jour, semaine (lundi → dimanche, bornée à la période) ou mois.
   * @returns [{ cle, lib, du, au, jours, b2c, b2b, total, reseau, ratioB2B, pdm }]
   */
  function serie(lignes, { partenaire, statuts, du, au, gran = 'jour' }) {
    const pj = parJour(lignes, { partenaire, statuts, du, au }), out = [];
    if (gran === 'jour') joursEntre(du, au).forEach((j) => out.push(Object.assign(bilan(pj, j, j), { cle: j, lib: j.slice(8, 10) + '/' + j.slice(5, 7), du: j, au: j })));
    else if (gran === 'semaine') {
      for (let d = lundiDe(du); d <= au; d = ajouter(d, 7)) {
        const a = d < du ? du : d, b = ajouter(d, 6) > au ? au : ajouter(d, 6), s = semaineIso(d);
        out.push(Object.assign(bilan(pj, a, b), { cle: s.annee + '-S' + String(s.num).padStart(2, '0'), lib: 'S' + s.num + ' (' + a.slice(8, 10) + '/' + a.slice(5, 7) + ')', du: a, au: b }));
      }
    } else {
      for (let c = du.slice(0, 7); c <= au.slice(0, 7); c = moisDecale(c, 1)) {
        const a = c + '-01' < du ? du : c + '-01', b = finMois(c) > au ? au : finMois(c);
        out.push(Object.assign(bilan(pj, a, b), { cle: c, lib: libMois(c), du: a, au: b }));
      }
    }
    return out;
  }

  /**
   * Regroupe des comptes journaliers [{ jour, …nombres }] par jour, semaine ISO (lundi → dimanche) ou mois : mêmes champs, additionnés.
   * Libellés : « 05/10 », « S41 (05/10) » (premier jour présent de la semaine), « Octobre 2026 ».
   */
  function regrouper(jours, gran = 'jour') {
    const m = new Map();
    [...jours].sort((a, b) => (a.jour < b.jour ? -1 : 1)).forEach((j) => {
      const cle = gran === 'semaine' ? (() => { const s = semaineIso(j.jour); return s.annee + '-S' + String(s.num).padStart(2, '0'); })() : gran === 'mois' ? j.jour.slice(0, 7) : j.jour;
      let g = m.get(cle);
      if (!g) { const s = gran === 'semaine' ? semaineIso(j.jour) : null; m.set(cle, (g = { cle, du: j.jour, lib: gran === 'semaine' ? 'S' + s.num + ' (' + j.jour.slice(8, 10) + '/' + j.jour.slice(5, 7) + ')' : gran === 'mois' ? libMois(cle) : j.jour.slice(8, 10) + '/' + j.jour.slice(5, 7) })); }
      Object.keys(j).forEach((k) => { if (k !== 'jour' && typeof j[k] === 'number') g[k] = (g[k] || 0) + j[k]; });
    });
    return [...m.values()];
  }

  /* ---------- Comparaisons ---------- */
  /**
   * Day on Day : les `n` derniers jours jusqu'à `au`, chacun comparé à la veille. objectifJour : objectif du jour (Paramètres).
   */
  function dayOnDay(lignes, { partenaire, statuts, au, n = 7, objectifJour = 0 }) {
    const du = ajouter(au, -n), pj = parJour(lignes, { partenaire, statuts, du, au });
    const jours = joursEntre(ajouter(au, -n + 1), au).map((j) => {
      const g = bilan(pj, j, j), v = bilan(pj, ajouter(j, -1), ajouter(j, -1));
      return Object.assign(g, { jour: j, veille: v.total, evol: evol(g.total, v.total), tauxObjectif: pct(g.total, objectifJour) });
    });
    return { jours, objectifJour };
  }
  /**
   * Week on Week dans un mois : semaines (lundi → dimanche) bornées au mois et à `au`, chacune comparée à la précédente.
   * objectifMois : objectif du mois (Paramètres) → TRO = ventes du mois ÷ objectif.
   */
  function weekOnWeek(lignes, { partenaire, statuts, cle, au, objectifMois = 0 }) {
    const fin = finMois(cle) < au ? finMois(cle) : au;
    const s = serie(lignes, { partenaire, statuts, du: cle + '-01', au: fin, gran: 'semaine' });
    s.forEach((x, i) => { x.rang = 'S' + (i + 1); x.precedente = i ? s[i - 1].total : null; x.evol = i ? evol(x.total, s[i - 1].total) : null; x.ecart = i ? x.total - s[i - 1].total : null; });
    const tot = s.reduce((a, x) => { a.b2c += x.b2c; a.b2b += x.b2b; a.total += x.total; a.reseau += x.reseau; return a; }, { b2c: 0, b2b: 0, total: 0, reseau: 0 });
    return { semaines: s, total: finir(tot), objectifMois, tro: pct(tot.total, objectifMois) };
  }
  /**
   * Month on Month : chaque mois de `mois` (clés AAAA-MM, ordre chronologique), arrêté à `au`.
   * Pour une comparaison juste, `aDate` compare aussi le même nombre de jours écoulés (du 1er au même jour du mois).
   * objectifs : { 'AAAA-MM': objectif du mois }.
   */
  function monthOnMonth(lignes, { partenaire, statuts, mois, au, objectifs = {} }) {
    const pj = parJour(lignes, { partenaire, statuts });
    const jourRef = +au.slice(8, 10);
    return mois.map((c, i) => {
      const fin = finMois(c) < au ? finMois(c) : au, g = bilan(pj, c + '-01', fin);
      const jMemeJour = c + '-' + String(Math.min(jourRef, +finMois(c).slice(8, 10))).padStart(2, '0'), aDate = bilan(pj, c + '-01', jMemeJour < fin ? jMemeJour : fin);
      const prec = i ? mois[i - 1] : null, gp = prec ? bilan(pj, prec + '-01', finMois(prec) < au ? finMois(prec) : au) : null;
      const pDate = prec ? bilan(pj, prec + '-01', prec + '-' + String(Math.min(jourRef, +finMois(prec).slice(8, 10))).padStart(2, '0')) : null;
      return Object.assign(g, { cle: c, lib: libMois(c), complet: fin === finMois(c), objectif: objectifs[c] || 0, tro: pct(g.total, objectifs[c] || 0), moyJour: g.jours ? g.total / g.jours : 0,
        evol: gp ? evol(g.total, gp.total) : null, evolADate: pDate ? evol(aDate.total, pDate.total) : null, aDate: aDate.total, aDatePrec: pDate ? pDate.total : null, jourComparaison: jourRef });
    });
  }
  /**
   * Same Period : la même semaine du mois (S1 = jours 1 à 7, S2 = 8 à 14, … S5 = 29 à fin) pour chaque mois, comparée au mois précédent.
   */
  function samePeriod(lignes, { partenaire, statuts, mois, au, rang = 1 }) {
    const pj = parJour(lignes, { partenaire, statuts });
    return mois.map((c, i) => {
      const a = c + '-' + String((rang - 1) * 7 + 1).padStart(2, '0'), b0 = rang >= 5 ? finMois(c) : c + '-' + String(rang * 7).padStart(2, '0');
      if (a > finMois(c) || a > au) return { cle: c, lib: libMois(c), du: a, au: null, disponible: false };
      const b = b0 > au ? au : b0, g = bilan(pj, a, b);
      return Object.assign(g, { cle: c, lib: libMois(c), du: a, au: b, disponible: true, complet: b === b0 });
    }).map((x, i, all) => Object.assign(x, { ecart: i && x.disponible && all[i - 1].disponible ? x.total - all[i - 1].total : null, evol: i && x.disponible && all[i - 1].disponible ? evol(x.total, all[i - 1].total) : null }));
  }
  /**
   * Écart aux objectifs (Paramètres) : jours ouvrés (objectif du jour) et semaines (objectif de la semaine, jour × jours ouvrés
   * pour une semaine incomplète). estOuvre(jour) indique un jour ouvré du calendrier.
   */
  function gapObjectifs(lignes, { partenaire, statuts, du, au, objectifJour, objectifSemaine, estOuvre }) {
    const pj = parJour(lignes, { partenaire, statuts, du, au });
    const jours = joursEntre(du, au).filter(estOuvre).map((j) => { const g = bilan(pj, j, j); return { jour: j, ventes: g.total, objectif: objectifJour, taux: pct(g.total, objectifJour), ecart: g.total - objectifJour }; });
    const semaines = serie(lignes, { partenaire, statuts, du, au, gran: 'semaine' }).map((s) => {
      const ouvres = joursEntre(s.du, s.au).filter(estOuvre).length, entiere = ouvres === joursEntre(lundiDe(s.du), ajouter(lundiDe(s.du), 6)).filter(estOuvre).length;
      const objectif = entiere ? objectifSemaine : objectifJour * ouvres;
      return { cle: s.cle, lib: s.lib, du: s.du, au: s.au, ventes: s.total, ouvres, objectif, taux: pct(s.total, objectif), ecart: s.total - objectif };
    });
    return { jours, semaines };
  }

  /* ---------- Alertes et recommandations (mois de `au` comparé au mois précédent, à date égale) ---------- */
  /**
   * @param ctx { partenaire, statuts, au, objectif: { b2c, b2b } (mois de au), ouvresRestants, agentsActifs }
   * @returns [{ niveau 'pos'|'warn'|'neg'|'info', icone, titre, detail }]
   */
  function alertes(lignes, ctx) {
    const { partenaire, statuts, au } = ctx, cle = au.slice(0, 7), prec = moisDecale(cle, -1), out = [];
    const pj = parJour(lignes, { partenaire, statuts });
    const jr = +au.slice(8, 10), jp = Math.min(jr, +finMois(prec).slice(8, 10));
    const m = bilan(pj, cle + '-01', au), p = bilan(pj, prec + '-01', prec + '-' + String(jp).padStart(2, '0'));
    const aPrec = lignes.some((l) => l.jour && l.jour.slice(0, 7) === prec);
    const objTot = (ctx.objectif.b2c || 0) + (ctx.objectif.b2b || 0), ratioObj = pct(ctx.objectif.b2b || 0, objTot);
    const f = (x) => (x == null ? '—' : (x * 100).toFixed(1).replace('.', ',') + ' %'), n = (x) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const periode = 'du 1er au ' + jr + ' ' + MOIS[+cle.slice(5, 7) - 1];
    // 1. Croissance à date égale
    if (aPrec && p.total > 0) {
      const e = evol(m.total, p.total);
      out.push({ niveau: e >= 0 ? 'pos' : 'neg', icone: e >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', titre: (e >= 0 ? 'Croissance' : 'Recul') + ' vs ' + MOIS[+prec.slice(5, 7) - 1] + ' à date égale : ' + (e >= 0 ? '+' : '') + f(e),
        detail: n(m.total) + ' ventes ' + periode + ' contre ' + n(p.total) + ' sur les mêmes jours du mois précédent.' + (e >= 0 ? ' Consolider le rythme.' : ' Relancer les équipes dès maintenant.') });
    } else out.push({ niveau: 'info', icone: 'fa-circle-info', titre: 'Pas de mois précédent en base pour comparer', detail: 'Les comparaisons mois par mois apparaîtront dès que les ventes de ' + libMois(prec) + ' seront importées.' });
    // 2. Ratio B2B vs objectif et vs mois précédent
    if (m.total > 0 && ratioObj != null) {
      const bas = m.ratioB2B < ratioObj, recul = aPrec && p.ratioB2B != null && m.ratioB2B < p.ratioB2B;
      out.push({ niveau: bas ? (recul ? 'neg' : 'warn') : 'pos', icone: 'fa-building', titre: 'Ratio B2B : ' + f(m.ratioB2B) + ' (objectif ' + f(ratioObj) + ')' + (aPrec && p.ratioB2B != null ? ' — ' + f(p.ratioB2B) + ' le mois précédent' : ''),
        detail: bas ? 'Le B2B est sous la part prévue par les objectifs (' + n(ctx.objectif.b2b) + ' B2B sur ' + n(objTot) + ').' + (recul ? ' Il recule : mobiliser les vendeurs B2B.' : '') : 'Le mix B2B est conforme ou supérieur aux objectifs.' });
    }
    // 3. Part de marché
    if (m.reseau > 0) {
      const e = aPrec && p.pdm != null ? m.pdm - p.pdm : null;
      out.push({ niveau: e == null ? 'info' : e >= 0 ? 'pos' : 'warn', icone: 'fa-chart-pie', titre: 'Part de marché ' + partenaire + ' : ' + f(m.pdm) + (e == null ? '' : ' (' + (e >= 0 ? '+' : '') + (e * 100).toFixed(1).replace('.', ',') + ' pt vs mois précédent)'),
        detail: n(m.total) + ' ventes sur ' + n(m.reseau) + ' pour tout le réseau Celtiis ' + periode + '.' });
    }
    // 4. Écarts B2C / B2B aux objectifs du mois, et rythme nécessaire
    const gapC = Math.max(0, (ctx.objectif.b2c || 0) - m.b2c), gapB = Math.max(0, (ctx.objectif.b2b || 0) - m.b2b), r = ctx.ouvresRestants || 0;
    if (objTot > 0) {
      out.push({ niveau: gapC + gapB === 0 ? 'pos' : 'warn', icone: 'fa-bullseye', titre: 'Objectif du mois : ' + n(m.total) + ' / ' + n(objTot) + ' (' + f(pct(m.total, objTot)) + ')',
        detail: gapC + gapB === 0 ? 'Objectif atteint.' : 'Reste ' + n(gapC) + ' B2C et ' + n(gapB) + ' B2B' + (r ? ', soit ' + (Math.ceil(((gapC + gapB) / r) * 10) / 10).toString().replace('.', ',') + ' ventes par jour ouvré sur les ' + r + ' jours restants.' : ' (plus aucun jour ouvré ce mois).') });
    }
    // 5. Meilleurs vendeurs du mois et vendeurs en forte baisse (≥ 50 % à date égale, au moins 4 ventes le mois précédent)
    const parLogin = (a, b) => { const mm = new Map(); for (const l of lignes) { if (l.partenaire !== partenaire || !statuts.includes(l.statut) || !l.jour || l.jour < a || l.jour > b) continue; mm.set(l.loginKey, (mm.get(l.loginKey) || 0) + 1); } return mm; };
    const cur = parLogin(cle + '-01', au), top = [...cur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length) out.push({ niveau: 'pos', icone: 'fa-trophy', titre: 'Top 3 vendeurs du mois : ' + top.map(([k, v]) => k + ' (' + v + ')').join(', '), detail: 'Les piliers du mois : à valoriser et à mobiliser comme référents des vendeurs en difficulté.' });
    if (aPrec) {
      const avant = parLogin(prec + '-01', prec + '-' + String(jp).padStart(2, '0'));
      const chute = [...avant.entries()].filter(([k, v]) => v >= 4 && (cur.get(k) || 0) <= v * 0.5).sort((a, b) => b[1] - a[1]);
      if (chute.length) out.push({ niveau: 'neg', icone: 'fa-person-falling', titre: chute.length + ' vendeur(s) en forte baisse (−50 % ou plus à date égale)', detail: chute.slice(0, 8).map(([k, v]) => k + ' ' + (cur.get(k) || 0) + ' contre ' + v).join(' · ') + '. Faire un point individuel cette semaine.' });
    }
    // 6. Ventes en attente de validation (statut non compté, ex. VALIDE)
    const attente = lignes.filter((l) => l.partenaire === partenaire && l.jour && l.jour >= cle + '-01' && l.jour <= au && !statuts.includes(l.statut)).length;
    if (attente) out.push({ niveau: 'warn', icone: 'fa-hourglass-half', titre: n(attente) + ' vente(s) ' + partenaire + ' en attente de validation ce mois-ci', detail: 'Non comptées tant qu\'elles ne passent pas au statut validé : à relancer pour les transformer en ventes payées.' });
    return out;
  }

  /* ---------- Prévisions (méthode du Directeur Général, adaptée aux données en base) ----------
     Base : ventes par agent et par jour ouvré, moyenne des mois complets disponibles (2 au plus) ; à défaut, le mois en cours.
     Taux journalier réaliste = agents × base × (1 + croissance) ; pessimiste = × 0,75 ; optimiste = × 1,25.
     Mois en cours : réalisé + taux × jours ouvrés restants ; mois suivants : taux × jours ouvrés.
     B2B projeté = total × ratio B2B historique ; commissions et marge = total × montant moyen par vente historique. */
  const SCENARIOS = { pessimiste: 0.75, realiste: 1, optimiste: 1.25 };
  /**
   * @param h { basesMois: [{ ventes, b2b, ouvres, agents }], commParVente, margeParVente }
   * @param mois [{ cle, ouvres, ouvresEcoules, realise, realiseB2B, croissance (%), objB2C, objB2B, agents }]
   */
  function previsions(h, mois) {
    const bases = h.basesMois.filter((b) => b.ouvres > 0 && b.agents > 0);
    const basePerAgent = bases.length ? bases.reduce((s, b) => s + b.ventes / b.ouvres / b.agents, 0) / bases.length : 0;
    const vt = bases.reduce((s, b) => s + b.ventes, 0), ratioB2B = vt ? bases.reduce((s, b) => s + b.b2b, 0) / vt : 0;
    const res = mois.map((m) => {
      const g = Math.max(-50, Math.min(100, +m.croissance || 0)) / 100, restants = Math.max(0, m.ouvres - (m.ouvresEcoules || 0));
      const sc = {};
      for (const [k, f] of Object.entries(SCENARIOS)) {
        const taux = m.agents * basePerAgent * (1 + g) * f;
        const total = Math.round((m.realise || 0) + taux * restants), b2b = Math.round((m.realiseB2B || 0) + taux * restants * ratioB2B), obj = (m.objB2C || 0) + (m.objB2B || 0);
        sc[k] = { taux, total, b2b, b2c: total - b2b, atteinte: pct(total, obj), comm: total * h.commParVente, marge: total * h.margeParVente };
      }
      return Object.assign({}, m, { restants, scenarios: sc });
    });
    const totaux = {}; for (const k of Object.keys(SCENARIOS)) { const t = { total: 0, b2b: 0, b2c: 0, comm: 0, marge: 0, obj: 0 }; res.forEach((m) => { const s = m.scenarios[k]; t.total += s.total; t.b2b += s.b2b; t.b2c += s.b2c; t.comm += s.comm; t.marge += s.marge; t.obj += (m.objB2C || 0) + (m.objB2B || 0); }); t.atteinte = pct(t.total, t.obj); totaux[k] = t; }
    return { basePerAgent, ratioB2B, mois: res, totaux };
  }

  return { versDate, versJour, ajouter, lundiDe, semaineIso, finMois, moisDecale, joursEntre, libMois, parJour, bilan, serie, regrouper, dayOnDay, weekOnWeek, monthOnMonth, samePeriod, gapObjectifs, alertes, previsions, SCENARIOS };
});
