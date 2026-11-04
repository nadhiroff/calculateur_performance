/* ============================================================================
   analyse.js — pages d'analyse (inspirées de « RGZ Intelligence », recalculées depuis la base) :
     • Tableau de bord RGZ : indicateurs du mois, progression vs objectifs, ventes et part de marché par mois,
       évolution (tendance B2C/B2B, ratio B2B, PDM) par jour / semaine / mois, alertes et recommandations ;
     • Comparaisons : Day on Day, Week on Week, Month on Month, Same Period, écart aux objectifs ;
     • Prévisions : projection du mois en cours et des 2 suivants, 3 scénarios (méthode du Directeur Général).
   Données : les 3 derniers mois jusqu'à la date de fin (en haut de l'écran), lus en base ; calculs dans analyse_calc.js ;
   objectifs, calendrier et statuts comptés de Paramètres ; commissions et marge = mêmes calculs que Point du jour / Performance.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT, A = CT.analyseCalc, $ = (s, r) => (r || document).querySelector(s);
  const mn = (n) => CT.fmt.int(n), fc = (n) => CT.fmt.fcfa(n), esc = CT.esc, pc = (x, d = 1) => CT.fmt.pct(x, d);
  const VUES = { comparaisons: 'Comparaisons', previsions: 'Prévisions' };
  const S = { cle: null, data: null, charge: null, wowMois: null, spRang: 1, scenario: 'realiste', params: {}, graphes: {} };

  /* ---------- Données : 3 derniers mois jusqu'à la date de fin ---------- */
  /* 3 mois jusqu'à la date de fin, étendus à la date de début si la période choisie commence plus tôt (ex. une année) */
  function fenetre() { const e = CT.etat; if (!e || !e.jourRef) return null; const au = e.jourRef, trois = A.moisDecale(au.slice(0, 7), -2) + '-01', deb = CT.periode.perfDu(); return { du: deb < trois ? deb.slice(0, 7) + '-01' : trois, au }; }
  const gran = () => CT.etat.gran || 'jour';
  async function donnees() {
    const e = CT.etat, f = fenetre(); if (!f || !e.res) return null;
    const cle = f.du + '|' + f.au + '|' + e.toutes.length + '|' + (e.meta ? e.meta.nom : '');
    if (S.cle === cle && S.data) return S.data;
    if (S.charge && S.charge.cle === cle) return S.charge.promesse;
    const promesse = (async () => {
      let toutes, entete;
      if (e.charge && e.charge.du <= f.du && e.charge.au >= f.au) { toutes = e.toutes.filter((l) => l.jour && l.jour >= f.du && l.jour <= f.au); entete = e.res.enteteBrut; }
      else {   // la période affichée ne couvre pas les 3 mois : lecture complémentaire en base (mêmes règles de classement)
        const d = await CT.api.souscriptions.aoa({ du: f.du, au: f.au });
        const res = await CT.parser.depuisAoa([d.entetes].concat(d.lignes), null, 'Base Celtiis (MySQL)');
        CT.parser.classer(res.lignes, CT.store.actifs(f.au.slice(0, 7)).regles, CT.store.get().partenaires);
        toutes = res.lignes; entete = res.enteteBrut;
      }
      const lignes = CT.parser.retenues(toutes);
      const mois = []; for (let c = f.du.slice(0, 7); c <= f.au.slice(0, 7); c = A.moisDecale(c, 1)) if (lignes.some((l) => l.jour && l.jour.slice(0, 7) === c)) mois.push(c);
      const r = { du: f.du, au: f.au, toutes, lignes, entete, mois: mois.length ? mois : [f.au.slice(0, 7)], cle };
      S.cle = cle; S.data = r; return r;
    })();
    S.charge = { cle, promesse };
    try { return await promesse; } finally { S.charge = null; }
  }

  /* ---------- Paramètres d'un mois (Paramètres › Objectifs et Règles) ---------- */
  function paramsMois(cle) {
    const P = CT.store.actifs(cle), obj = P.objectifs, t = CT.objectifs.totaux(obj), propre = obj.periode === cle && !P.herite;   // hérité : calendrier lundi–vendredi du mois
    const ouvre = (j) => (propre ? obj.calendrier.ouvres.includes(+j.slice(8, 10)) : (() => { const d = A.versDate(j).getUTCDay(); return d > 0 && d < 6; })());
    const ouvres = A.joursEntre(cle + '-01', A.finMois(cle)).filter(ouvre).length;
    return { obj, t, ouvre, ouvres, propre, statuts: P.regles.statuts_comptes || ['OK'], herite: !propre };
  }
  /* Commissions agents et marge du partenaire sur [du → au] d'un mois : mêmes calculs que les autres pages */
  function commissions(lignes, cle, au, du = cle + '-01') {
    const pr = CT.etat.prioritaire, motiv = CT.calc.motivation(lignes, { cle, jourRef: au, prioritaire: pr });
    const cp = CT.calc.commissionsPrimes(lignes, { cle, du, au, partenaire: pr, motiv, mode: 'cumul' });
    return { agents: cp.total.vendeurs, marge: cp.total.partenaire, total: cp.total.general };
  }

  /* ---------- Rubriques : chaque sous-menu du sidebar affiche SA rubrique seule (#rgz/evolution, #comparaisons/wow…) ---------- */
  const RUBS = { rgz: ['apercu', 'evolution', 'alertes'], previsions: ['projection', 'parametres', 'scenarios', 'agents'] };
  const ALIAS = { indicateurs: 'apercu', objectifs: 'evolution', mois: 'evolution' };   // anciennes adresses
  function rubrique(nom) { let sous = location.hash.split('/')[1]; if (nom === 'rgz' && ALIAS[sous]) sous = ALIAS[sous]; return RUBS[nom].includes(sous) ? sous : RUBS[nom][0]; }
  const bloc = (rubs, html) => `<div data-rub="${rubs}" class="stack">${html}</div>`;   // espacement standard entre titre, cartes et graphiques
  function filtrer(root, nom) { const r = rubrique(nom); root.querySelectorAll('[data-rub]').forEach((el) => { el.hidden = !el.dataset.rub.split(' ').includes(r); }); }

  /* ---------- Briques d'affichage (design du projet) ---------- */
  const jeton = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const palette = () => [1, 2, 3, 4, 5, 6].map((i) => jeton('--series-' + i));
  function graphe(id, cfg) {
    const cv = document.getElementById(id); if (!cv) return;
    if (!cv.offsetParent) { if (S.graphes[id]) { S.graphes[id].destroy(); delete S.graphes[id]; } return; }   // rubrique masquée : rien à dessiner
    if (!window.Chart) { cv.parentElement.innerHTML = '<p class="muted">Graphique indisponible (Chart.js non chargé).</p>'; return; }
    if (S.graphes[id]) S.graphes[id].destroy();
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } } }, cfg.options || {});
    Object.values(cfg.options.scales || {}).forEach((a) => { a.border = { display: false }; a.grid = Object.assign({ color: jeton('--chart-grid') }, a.grid); });
    S.graphes[id] = new Chart(cv, cfg);
  }
  const kpi = (icone, ton, label, valeur, sub) => `<div class="kpi"><div class="kpi-icon ${ton}" aria-hidden="true"><i class="fa-solid ${icone}"></i></div><div><div class="kpi-label">${label}</div><div class="kpi-value num">${CT.valeurKpi(valeur)}</div><div class="kpi-sub">${sub}</div></div></div>`;
  const carte = (id, titre, sous, corps, actions = '') => `<section class="card" id="${id}" style="scroll-margin-top:96px"><div class="card-head"><div>${titre ? `<h3>${titre}</h3>` : ''}<p>${sous}</p></div>${actions}</div>${corps}</section>`;
  /* Comparaisons : une seule page, chaque partie sous un grand titre bien visible */
  const titreSection = (t) => `<h2 class="titre-section">${t}</h2>`;
  const boutons = (nom, liste, actif) => `<div class="chips" role="group" data-groupe="${nom}">${liste.map(([v, lib]) => `<button type="button" class="btn btn-sm ${String(v) === String(actif) ? 'btn-primary' : 'btn-secondary'}" aria-pressed="${String(v) === String(actif)}" data-${nom}="${esc(String(v))}">${esc(lib)}</button>`).join('')}</div>`;
  const evolTxt = (x) => (x == null ? '' : ` <small class="${x >= 0 ? 'txt-pos' : 'txt-neg'}">${x >= 0 ? '+' : ''}${pc(x, 0)}</small>`);
  const vide = (t) => `<div class="card empty"><i class="fa-solid fa-chart-line" aria-hidden="true"></i><h3>Aucune donnée pour le moment</h3><p>${t}</p></div>`;
  const chargement = '<div class="card empty" aria-busy="true"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><h3>Calcul en cours…</h3></div>';
  const barre = (reel, cible) => { const p = cible > 0 ? reel / cible : 0; return `<div class="progress ${p >= 1 ? 'pos' : p >= 0.6 ? '' : p >= 0.35 ? 'warn' : 'neg'}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(p * 100))}"><span style="width:${Math.min(100, p * 100)}%"></span></div>`; };

  /* ======================= TABLEAU DE BORD RGZ : compléments ======================= */
  async function rendreRgz() {
    const root = $('#rgz-plus'); if (!root) return;
    if (!CT.etat.lignes.length) { root.innerHTML = ''; return; }
    const rc = $('#rgz-content'), apercu = rubrique('rgz') === 'apercu';
    if (rc) rc.hidden = !apercu; root.hidden = apercu;
    if (!apercu) root.innerHTML = chargement;
    let d; try { d = await donnees(); } catch (er) { if (!apercu) root.innerHTML = vide('Lecture des mois précédents impossible : ' + esc(er.message)); return; }
    if (!d) { root.innerHTML = ''; return; }
    const pr = CT.etat.prioritaire, au = d.au;
    // Période = barre de l'en-tête (date de début → date de fin), sur un ou plusieurs mois ; objectifs des mois touchés
    const du = CT.periode.perfDu(), fin = au, moisSel = [];
    for (let c = du.slice(0, 7); c <= fin.slice(0, 7); c = A.moisDecale(c, 1)) moisSel.push(c);
    const st = paramsMois(au.slice(0, 7)).statuts, P = { partenaire: pr, statuts: st };
    const b = A.serie(d.lignes, Object.assign({ du, au: fin, gran: 'mois' }, P)).reduce((a, x) => { a.b2c += x.b2c; a.b2b += x.b2b; a.total += x.total; a.reseau += x.reseau; return a; }, { b2c: 0, b2b: 0, total: 0, reseau: 0 });
    const objs = moisSel.map((c) => paramsMois(c).t), objC = CT.somme(objs, (t) => t.b2c), objB = CT.somme(objs, (t) => t.b2b), objT = objC + objB;
    const cm = moisSel.map((c) => commissions(d.lignes, c, A.finMois(c) < au ? A.finMois(c) : au, du > c + '-01' ? du : c + '-01'));
    const comAg = CT.somme(cm, (x) => x.agents), marge = CT.somme(cm, (x) => x.marge);
    const libSel = du === fin ? CT.date.court(du) : 'du ' + CT.date.court(du) + ' au ' + CT.date.court(fin);
    const ratioObj = objT ? objB / objT : null, pdm = b.reseau ? b.total / b.reseau : null;
    const parMois = A.serie(d.lignes, Object.assign({ du: d.mois[0] + '-01', au, gran: 'mois' }, P));

    // Vue d'ensemble : ratios, réseau, part de marché et marge SOUS les tuiles de la page (même format), période de l'en-tête
    if (apercu) {
      const zone = rc && rc.querySelector('.grid-tuiles'); if (!zone || CT.etat.vue !== 'rgz') return;
      const ancien = document.getElementById('rgz-indic-plus'); if (ancien) ancien.remove();
      const rB = b.total ? b.b2b / b.total : null, rC = b.total ? b.b2c / b.total : null, objRC = objT ? objC / objT : null;
      const ton = (r, o) => (r == null || o == null ? '' : r >= o ? 'pos' : 'warn');
      zone.insertAdjacentHTML('afterend', `<div class="grid-tuiles" id="rgz-indic-plus" style="margin-top:var(--sp-4)">${[
        CT.ui.tuile({ icone: 'fa-building', ton: ton(rB, ratioObj), titre: 'Ratio B2B', valeur: pc(rB), aide: 'objectif ' + pc(ratioObj) + ' · ' + mn(b.b2b) + ' ventes entreprises' }),
        CT.ui.tuile({ icone: 'fa-house-user', ton: ton(rC, objRC), titre: 'Ratio B2C', valeur: pc(rC), aide: 'objectif ' + pc(objRC) + ' · ' + mn(b.b2c) + ' ventes particuliers' }),
        CT.ui.tuile({ icone: 'fa-network-wired', titre: 'Total réseau', valeur: mn(b.reseau), aide: 'ventes Celtiis, tous partenaires · ' + esc(libSel) }),
        CT.ui.tuile({ icone: 'fa-chart-pie', ton: 'info', titre: 'Part de marché ' + esc(pr), valeur: pc(pdm), aide: mn(b.total) + ' ventes sur ' + mn(b.reseau) }),
        CT.ui.tuile({ icone: 'fa-sack-dollar', ton: 'pos', titre: 'Marge ' + esc(pr), valeur: fc(marge), aide: 'part ' + esc(pr) + ' des commissions' })].join('')}</div>`);
      return;
    }
    const prog = titreSection('🎯 Progression vs objectifs (' + mn(objC) + ' B2C + ' + mn(objB) + ' B2B)') + carte('sec-rgz-objectifs', '', 'Objectifs de Paramètres › Objectifs · ' + esc(libSel) + (objs.length && moisSel.some((c) => paramsMois(c).herite) ? ' · un mois sans objectifs propres reprend ceux du mois précédent' : ''),
      `<div class="obj-grid">${[['B2C', b.b2c, objC], ['B2B', b.b2b, objB], ['Total', b.total, objT]].map(([l, r, o]) => `<div class="obj-row"><div class="top"><span>${l} (objectif ${mn(o)})</span><b class="num">${mn(r)} · ${pc(o ? r / o : null, 0)}</b></div>${barre(r, o)}<div class="mini-cap">${o > r ? 'Manquant : ' + mn(o - r) : 'Objectif atteint'}</div></div>`).join('')}</div>`);
    const mensuel = titreSection('📅 Ventes et part de marché par mois') + `<div class="grid-2">${carte('sec-rgz-mois', '📅 Ventes ' + esc(pr) + ' par mois', 'B2C + B2B, mois en cours arrêté au ' + CT.date.court(au), '<div class="chart-box"><canvas id="an-ch-mois" role="img" aria-label="Ventes par mois"></canvas></div>')}
      ${carte('sec-rgz-pdm', '📊 Part de marché par mois', 'Ventes ' + esc(pr) + ' ÷ ventes de tout le réseau Celtiis', '<div class="chart-box"><canvas id="an-ch-pdm-mois" role="img" aria-label="Part de marché par mois"></canvas></div>')}</div>`;
    const evo = titreSection('📈 Évolution des ventes') + `<div id="sec-rgz-evolution"></div>${carte('an-evo', 'Tendance B2C / B2B / total', 'Tendance ' + esc(pr) + ' B2C / B2B / total · vue par ' + gran() + ' · ' + esc(libSel) + (gran() === 'semaine' ? ' · S41 = 41e semaine de l\'année (lundi → dimanche), suivie de son 1er jour' : ''), '<div class="chart-box tall"><canvas id="an-ch-evo" role="img" aria-label="Tendance des ventes"></canvas></div>')}
      <div class="grid-2">${carte('an-ratio', 'Ratio B2B par période', 'Part des ventes B2B (entreprises) dans les ventes ' + esc(pr) + ' · objectif ' + pc(ratioObj), '<div class="chart-box"><canvas id="an-ch-ratio" role="img" aria-label="Ratio B2B"></canvas></div>')}
      ${carte('an-pdm', 'Part de marché par période', esc(pr) + ' ÷ réseau Celtiis', '<div class="chart-box"><canvas id="an-ch-pdm" role="img" aria-label="Part de marché"></canvas></div>')}</div>`;
    const objAu = paramsMois(au.slice(0, 7)), ouvRest = A.joursEntre(A.ajouter(au, 1), A.finMois(au.slice(0, 7))).filter(objAu.ouvre).length;
    const al = A.alertes(d.lignes, Object.assign({ au, objectif: { b2c: objAu.t.b2c, b2b: objAu.t.b2b }, ouvresRestants: ouvRest }, P));
    const ic = { pos: 'succes', warn: 'alerte', neg: 'critique', info: 'info' };
    const alertes = carte('sec-rgz-alertes', '🔔 Alertes et recommandations', A.libMois(au.slice(0, 7)) + ' au ' + CT.date.court(au) + ', comparé au mois précédent sur les mêmes jours',
      `<ul class="alerts">${al.map((a) => `<li class="alert ${a.niveau}"><span class="alert-ic">${CT.icone(ic[a.niveau])}</span><div><strong>${esc(a.titre)}</strong><span>${esc(a.detail)}</span></div></li>`).join('')}</ul>`);
    root.innerHTML = `<div class="stack">${bloc('evolution', prog)}${bloc('evolution', mensuel)}${bloc('evolution', evo)}${bloc('alertes', alertes)}</div>`;
    filtrer(root, 'rgz');
    // Graphiques
    const PAL = palette(), s = A.serie(d.lignes, Object.assign({ du, au: fin, gran: gran() }, P)), lab = s.map((x) => x.lib);
    const barres = { borderRadius: 4, maxBarThickness: 36 };
    graphe('an-ch-mois', { type: 'bar', data: { labels: parMois.map((x) => x.lib), datasets: [Object.assign({ label: 'B2C', data: parMois.map((x) => x.b2c), backgroundColor: PAL[0], stack: 'v' }, barres), Object.assign({ label: 'B2B', data: parMois.map((x) => x.b2b), backgroundColor: PAL[2], stack: 'v' }, barres)] }, options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } } } });
    graphe('an-ch-pdm-mois', { type: 'bar', data: { labels: parMois.map((x) => x.lib), datasets: [Object.assign({ label: 'Part de marché (%)', data: parMois.map((x) => (x.pdm == null ? null : +(x.pdm * 100).toFixed(1))), backgroundColor: PAL[1] }, barres)] }, options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => v + ' %' } } } } });
    const ligne = (label, data, c, extra = {}) => Object.assign({ label, data, borderColor: c, backgroundColor: c, tension: 0.3, borderWidth: 2, pointRadius: s.length > 40 ? 0 : 2, spanGaps: true }, extra);
    graphe('an-ch-evo', { type: 'line', data: { labels: lab, datasets: [ligne('B2C', s.map((x) => x.b2c), PAL[0]), ligne('B2B', s.map((x) => x.b2b), PAL[2]), ligne('Total ' + pr, s.map((x) => x.total), PAL[3], { borderWidth: 3 })] }, options: { scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } } });
    const pcSerie = (k) => s.map((x) => (x[k] == null ? null : +(x[k] * 100).toFixed(1)));
    graphe('an-ch-ratio', { type: 'line', data: { labels: lab, datasets: [ligne('Ratio B2B (%)', pcSerie('ratioB2B'), PAL[2])].concat(ratioObj != null ? [ligne('Objectif (%)', lab.map(() => +(ratioObj * 100).toFixed(1)), jeton('--text-3'), { borderDash: [6, 4], pointRadius: 0, borderWidth: 1 })] : []) }, options: { scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => v + ' %' } } } } });
    graphe('an-ch-pdm', { type: 'line', data: { labels: lab, datasets: [ligne('Part de marché (%)', pcSerie('pdm'), PAL[1])] }, options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => v + ' %' } } } } });
    defiler();
  }

  /* ======================= COMPARAISONS ======================= */
  async function rendreComparaisons() {
    const root = $('#comparaisons-content'); if (!root) return;
    if (!CT.etat.lignes.length) { root.innerHTML = vide('Importez le fichier de souscriptions depuis le Tableau de bord.'); return; }
    root.innerHTML = chargement;
    let d; try { d = await donnees(); } catch (er) { root.innerHTML = vide('Lecture impossible : ' + esc(er.message)); return; }
    const pr = CT.etat.prioritaire, au = d.au, cle = au.slice(0, 7), pm = paramsMois(cle), P = { partenaire: pr, statuts: pm.statuts };
    if (!d.mois.includes(S.wowMois)) S.wowMois = cle;
    const dod = A.dayOnDay(d.lignes, Object.assign({ au, n: 7, objectifJour: pm.t.jour }, P));
    const pmW = paramsMois(S.wowMois), wow = A.weekOnWeek(d.lignes, Object.assign({ cle: S.wowMois, au, objectifMois: pmW.t.mois }, P));
    const objectifs = {}; d.mois.forEach((c) => { objectifs[c] = paramsMois(c).t.mois; });
    const mom = A.monthOnMonth(d.lignes, Object.assign({ mois: d.mois, au, objectifs }, P));
    const sp = A.samePeriod(d.lignes, Object.assign({ mois: d.mois, au, rang: S.spRang }, P));
    const gap = A.gapObjectifs(d.lignes, Object.assign({ du: cle + '-01', au, objectifJour: pm.t.jour, objectifSemaine: pm.t.semaine, estOuvre: pm.ouvre }, P));
    const tab = (id, cols, lignes, pied) => { const el = CT.table.creer({ pageSize: 0, caption: id, colonnes: cols, lignes, pied }).el; return el; };
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair('Ventes validées ' + esc(pr) + ' au ' + CT.date.court(au) + ' (date de fin en haut de l\'écran), sur ' + (d.mois.length > 1 ? 'les ' + d.mois.length + ' derniers mois' : 'le seul mois') + ' en base. Objectifs : Paramètres › Objectifs (jour ' + CT.fmt.nat(pm.t.jour) + ', semaine ' + CT.fmt.nat(pm.t.semaine) + ', mois ' + mn(pm.t.mois) + '). Semaines : S1, S2… = 1re, 2e semaine du mois ; S40, S41… = numéro de la semaine dans l\'année ; toujours du lundi au dimanche.', 'fa-circle-info')}
      ${bloc('dod', titreSection('📅 Day on Day') + carte('sec-comparaisons-dod', '', '7 derniers jours, chacun comparé à la veille · objectif du jour ' + CT.fmt.nat(pm.t.jour),
        `<div class="grid-kpi">${dod.jours.map((x) => kpi('fa-calendar-day', x.tauxObjectif != null && x.tauxObjectif >= 1 ? 'pos' : pm.ouvre(x.jour) ? 'warn' : '', CT.date.court(x.jour) + (pm.ouvre(x.jour) ? '' : ' · non ouvré'), mn(x.total) + evolTxt(x.evol), 'B2C ' + mn(x.b2c) + ' · B2B ' + mn(x.b2b) + (pm.ouvre(x.jour) ? ' · ' + pc(x.tauxObjectif, 0) + ' de l\'objectif' : ''))).join('')}</div>`))}
      ${bloc('wow', titreSection('📆 Week on Week') + carte('sec-comparaisons-wow', '', 'Semaines du lundi au dimanche dans le mois · TRO = ventes du mois ÷ objectif du mois', '<div id="cmp-wow"></div>', boutons('wow', d.mois.map((c) => [c, A.libMois(c)]), S.wowMois)))}
      ${bloc('mom', titreSection('🗓 Month on Month') + carte('sec-comparaisons-mom', '', 'Mois entiers, et à date égale (du 1er au ' + (+au.slice(8, 10)) + ' de chaque mois) pour une comparaison juste', '<div id="cmp-mom"></div>'))}
      ${bloc('sp', titreSection('🔄 Same Period') + carte('sec-comparaisons-sp', '', 'La même semaine du mois (S1 = jours 1 à 7, S2 = 8 à 14…) d\'un mois à l\'autre', '<div id="cmp-sp"></div>', boutons('sp', [1, 2, 3, 4, 5].map((r) => [r, 'S' + r]), S.spRang)))}
      ${bloc('gap', titreSection('🎯 Écart aux objectifs — ' + esc(A.libMois(cle))) + carte('sec-comparaisons-gap', '', 'Jours ouvrés (objectif du jour) et semaines (objectif de la semaine, ou du jour × jours ouvrés si la semaine est entamée)', '<div class="grid-2"><div id="cmp-gap-j"></div><div id="cmp-gap-s"></div></div>'))}
    </div>`;
    $('#cmp-wow').append(tab('Week on Week', [{ cle: 'rang', titre: 'Semaine' }, { cle: 'lib', titre: 'Du' }, { cle: 'jours', titre: 'Jours', num: true }, { cle: 'total', titre: 'Ventes', num: true, html: true, fmt: (v, x) => mn(v) + evolTxt(x.evol) },
      { cle: 'ecart', titre: 'vs sem. préc.', num: true, fmt: (v) => (v == null ? '—' : (v > 0 ? '+' : '') + mn(v)) }, { cle: 'b2c', titre: 'B2C', num: true, fmt: mn }, { cle: 'b2b', titre: 'B2B', num: true, fmt: mn }, { cle: 'reseau', titre: 'Réseau', num: true, fmt: mn }, { cle: 'pdm', titre: 'PDM', num: true, fmt: (v) => pc(v) }],
      wow.semaines, { rang: 'TOTAL', lib: wow.objectifMois ? mn(wow.total.total) + ' / ' + mn(wow.objectifMois) + ' · TRO ' + pc(wow.tro, 0) : '', total: wow.total.total, b2c: wow.total.b2c, b2b: wow.total.b2b, reseau: wow.total.reseau, pdm: wow.total.pdm }));
    $('#cmp-mom').append(tab('Month on Month', [{ cle: 'lib', titre: 'Mois' }, { cle: 'total', titre: 'Ventes', num: true, html: true, fmt: (v, x) => mn(v) + (x.complet ? '' : ' <small class="muted">(en cours)</small>') + evolTxt(x.evol) },
      { cle: 'aDate', titre: 'À date égale', num: true, html: true, fmt: (v, x) => mn(v) + evolTxt(x.evolADate) }, { cle: 'b2c', titre: 'B2C', num: true, fmt: mn }, { cle: 'b2b', titre: 'B2B', num: true, fmt: mn }, { cle: 'reseau', titre: 'Réseau', num: true, fmt: mn },
      { cle: 'pdm', titre: 'PDM', num: true, fmt: (v) => pc(v) }, { cle: 'tro', titre: 'TRO', num: true, html: true, fmt: (v, x) => (x.objectif ? pc(v, 0) + ' <small class="muted">' + mn(x.total) + ' / ' + mn(x.objectif) + '</small>' : '—') }, { cle: 'moyJour', titre: 'Moy. / jour', num: true, fmt: (v) => CT.fmt.dec(v, 1) }], mom));
    $('#cmp-sp').append(tab('Same Period', [{ cle: 'lib', titre: 'Mois' }, { cle: 'du', titre: 'Jours', fmt: (v, x) => (x.disponible ? CT.date.court(x.du) + ' → ' + CT.date.court(x.au) + (x.complet ? '' : ' (en cours)') : 'pas encore écoulée') },
      { cle: 'total', titre: 'Ventes', num: true, html: true, fmt: (v, x) => (x.disponible ? mn(v) + evolTxt(x.evol) : '—') }, { cle: 'b2c', titre: 'B2C', num: true, fmt: (v, x) => (x.disponible ? mn(v) : '—') }, { cle: 'b2b', titre: 'B2B', num: true, fmt: (v, x) => (x.disponible ? mn(v) : '—') },
      { cle: 'reseau', titre: 'Réseau', num: true, fmt: (v, x) => (x.disponible ? mn(v) : '—') }, { cle: 'ecart', titre: 'Écart vs mois préc.', num: true, fmt: (v) => (v == null ? '—' : (v > 0 ? '+' : '') + mn(v)) }], sp));
    const tg = (x) => `${mn(x.ventes)} / ${CT.fmt.nat(x.objectif)} <small class="${x.ecart >= 0 ? 'txt-pos' : 'txt-neg'}">${pc(x.taux, 0)}</small>`;
    $('#cmp-gap-j').append(tab('Objectif journalier', [{ cle: 'jour', titre: 'Jour ouvré', fmt: (v) => CT.date.court(v) }, { cle: 'ventes', titre: 'Ventes / objectif', num: true, html: true, fmt: (v, x) => tg(x) }, { cle: 'ecart', titre: 'Écart', num: true, fmt: (v) => (v > 0 ? '+' : '') + CT.fmt.nat(v) }], gap.jours));
    $('#cmp-gap-s').append(tab('Objectif hebdomadaire', [{ cle: 'lib', titre: 'Semaine' }, { cle: 'ouvres', titre: 'Jours ouvrés', num: true }, { cle: 'ventes', titre: 'Ventes / objectif', num: true, html: true, fmt: (v, x) => tg(x) }, { cle: 'ecart', titre: 'Écart', num: true, fmt: (v) => (v > 0 ? '+' : '') + CT.fmt.nat(v) }], gap.semaines));
    defiler();
  }

  /* ======================= PRÉVISIONS ======================= */
  async function rendrePrevisions() {
    const root = $('#previsions-content'); if (!root) return;
    if (!CT.etat.lignes.length) { root.innerHTML = vide('Importez le fichier de souscriptions depuis le Tableau de bord.'); return; }
    root.innerHTML = chargement;
    let d; try { d = await donnees(); } catch (er) { root.innerHTML = vide('Lecture impossible : ' + esc(er.message)); return; }
    const pr = CT.etat.prioritaire, au = d.au, cle = au.slice(0, 7), pm = paramsMois(cle), st = pm.statuts;
    const vendus = (c, a, b) => d.lignes.filter((l) => l.partenaire === pr && st.includes(l.statut) && l.jour && l.jour >= a && l.jour <= b && l.jour.slice(0, 7) === c);
    // Base historique : mois complets précédents disponibles (2 au plus), sinon le mois en cours à date
    const prec = d.mois.filter((c) => c < cle).slice(-2);
    const baseMois = (prec.length ? prec : [cle]).map((c) => {
      const p = paramsMois(c), fin = c === cle ? au : A.finMois(c), L = vendus(c, c + '-01', fin);
      return { cle: c, ventes: L.length, b2b: L.filter((l) => l.segment === 'B2B').length, ouvres: A.joursEntre(c + '-01', fin).filter(p.ouvre).length, agents: new Set(L.map((l) => l.loginKey)).size };
    });
    const Lc = vendus(cle, cle + '-01', au), agentsActifs = new Set(Lc.map((l) => l.loginKey)).size;
    const cm = commissions(d.lignes, cle, au), parVente = Lc.length ? { comm: cm.agents / Lc.length, marge: cm.marge / Lc.length } : { comm: 0, marge: 0 };
    const moisP = [cle, A.moisDecale(cle, 1), A.moisDecale(cle, 2)];
    const defaut = (c) => { const p = paramsMois(c); return { ouvres: p.ouvres, croissance: 10, objB2C: p.t.b2c, objB2B: p.t.b2b }; };
    moisP.forEach((c) => { if (!S.params[c]) S.params[c] = defaut(c); });
    if (S.params.agents == null) S.params.agents = agentsActifs || 1;
    const ouvEc = A.joursEntre(cle + '-01', au).filter(pm.ouvre).length;
    const r = A.previsions({ basesMois: baseMois, commParVente: parVente.comm, margeParVente: parVente.marge }, moisP.map((c, i) => Object.assign({ cle: c, agents: S.params.agents }, S.params[c],
      i === 0 ? { ouvresEcoules: ouvEc, realise: Lc.length, realiseB2B: Lc.filter((l) => l.segment === 'B2B').length } : {})));
    const sc = S.scenario, NOMS = { pessimiste: 'Pessimiste', realiste: 'Réaliste', optimiste: 'Optimiste' };
    S.dernierePrev = { r, sc, NOMS, baseMois, au };   // exports
    const t = r.totaux[sc];
    root.innerHTML = `<div class="stack">
      ${CT.ui.enClair(`Méthode : ventes par agent et par jour ouvré (<b>${CT.fmt.dec(r.basePerAgent, 3)}</b>, moyenne de ${baseMois.map((b) => esc(A.libMois(b.cle)) + ' : ' + mn(b.ventes) + ' ventes, ' + b.ouvres + ' j, ' + b.agents + ' agents').join(' ; ')}) × agents × (1 + croissance). Pessimiste = réaliste × 0,75 ; optimiste = × 1,25. Mois en cours : réalisé + rythme × jours ouvrés restants. Commissions et marge : montant moyen par vente de ${esc(A.libMois(cle))}.`, 'fa-circle-info')}
      <div data-rub="projection scenarios agents" class="stack"><div class="card" style="display:flex;flex-wrap:wrap;gap:var(--sp-4);align-items:center;padding:var(--sp-3) var(--sp-4)"><div><span class="kpi-label">Scénario actif</span>${boutons('sc', Object.entries(NOMS), sc)}</div><p class="muted" style="margin:0">Mois projetés : ${moisP.map((c) => esc(A.libMois(c))).join(', ')}</p></div>
      <div class="grid-kpi">
        ${kpi('fa-gauge', 'info', 'Ventes / jour (base)', CT.fmt.dec(S.params.agents * r.basePerAgent, 1), S.params.agents + ' agents × ' + CT.fmt.dec(r.basePerAgent, 3) + ' / agent / jour')}
        ${kpi('fa-calendar-check', '', 'Jours ouvrés restants', mn(r.mois[0].restants), mn(Lc.length) + ' ventes faites en ' + esc(A.libMois(cle)))}
        ${kpi('fa-chart-line', 'pos', 'Total projeté (' + NOMS[sc] + ')', mn(t.total), '3 mois · ' + pc(t.atteinte, 0) + ' des objectifs')}
        ${kpi('fa-user-tie', '', 'Comm. agents projetées', fc(t.comm), NOMS[sc])}
        ${kpi('fa-sack-dollar', 'pos', 'Marge ' + esc(pr) + ' projetée', fc(t.marge), NOMS[sc])}</div></div>
      ${bloc('projection', carte('sec-previsions-projection', '📅 Projection mensuelle', 'Les 3 scénarios par mois · % = projection ÷ objectif du mois', `<div class="grid-3">${r.mois.map((m, i) => `<div class="card" style="box-shadow:none">
          <h4>${esc(A.libMois(m.cle))} ${i === 0 ? '<span class="badge badge-warn">En cours</span>' : ''}</h4>
          <table class="table-compact"><thead><tr><th>Scénario</th><th class="num">Ventes</th><th class="num">% obj.</th><th class="num">/ jour</th></tr></thead><tbody>${Object.entries(NOMS).map(([k, n]) => `<tr${k === sc ? ' style="font-weight:700"' : ''}><td>${n}</td><td class="num">${mn(m.scenarios[k].total)}</td><td class="num">${pc(m.scenarios[k].atteinte, 0)}</td><td class="num">${CT.fmt.dec(m.scenarios[k].taux, 1)}</td></tr>`).join('')}</tbody></table>
          <p class="mini-cap" style="margin-top:8px">${mn(m.scenarios[sc].b2c)} B2C (obj. ${mn(m.objB2C)}) · ${mn(m.scenarios[sc].b2b)} B2B (obj. ${mn(m.objB2B)})<br>Comm. agents ${fc(m.scenarios[sc].comm)} · marge ${fc(m.scenarios[sc].marge)}<br>${i === 0 ? mn(m.realise) + ' réalisées · ' : ''}${m.ouvres} j ouvrés · croissance ${m.croissance} %</p></div>`).join('')}</div>`))}
      ${bloc('parametres', carte('sec-previsions-parametres', '⚙️ Paramètres par mois', 'Modifiables : jours ouvrés, croissance (−50 à +100 %), objectifs, nombre d\'agents · la projection se recalcule aussitôt (rien n\'est enregistré)',
        `<div class="grid-3">${moisP.map((c) => `<fieldset class="card" style="box-shadow:none"><legend><b>${esc(A.libMois(c))}</b></legend><div class="grid-2" style="gap:var(--sp-3)">
          ${[['ouvres', 'Jours ouvrés'], ['croissance', 'Croissance (%)'], ['objB2C', 'Objectif B2C'], ['objB2B', 'Objectif B2B']].map(([k, l]) => `<div class="field"><label for="pv-${c}-${k}">${l}</label><input class="input" type="number" id="pv-${c}-${k}" data-pv-mois="${c}" data-pv-cle="${k}" value="${S.params[c][k]}"${k === 'croissance' ? ' min="-50" max="100"' : ' min="0"'}></div>`).join('')}</div></fieldset>`).join('')}</div>
         <div class="field" style="max-width:260px;margin-top:var(--sp-4)"><label for="pv-agents">Agents projetés</label><input class="input" type="number" min="1" id="pv-agents" value="${S.params.agents}"><small class="muted">${agentsActifs} agents ont vendu en ${esc(A.libMois(cle))}</small></div>
         <p style="margin-top:var(--sp-3)"><button class="btn btn-secondary btn-sm" type="button" id="pv-reset"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Valeurs par défaut (Paramètres)</button></p>`))}
      ${bloc('scenarios', carte('sec-previsions-scenarios', 'Comparaison des scénarios — 3 mois', 'Ventes, objectifs, commissions et marge par mois et par scénario', '<div id="pv-tab"></div>'))}
      ${bloc('agents', carte('sec-previsions-agents', '👥 Contribution estimée par agent', 'Part de chaque agent dans les ventes de la base historique × projection du scénario ' + NOMS[sc], '<div id="pv-ag"></div>'))}
    </div>`;
    filtrer(root, 'previsions');
    const lignes = []; r.mois.forEach((m) => Object.entries(NOMS).forEach(([k, n]) => { const x = m.scenarios[k]; lignes.push({ mois: A.libMois(m.cle), sc: (k === sc ? '▶ ' : '') + n, taux: x.taux, total: x.total, b2c: x.b2c, b2b: x.b2b, att: x.atteinte, comm: x.comm, marge: x.marge }); }));
    $('#pv-tab').append(CT.table.creer({ pageSize: 0, caption: 'Scénarios', lignes, colonnes: [{ cle: 'mois', titre: 'Mois' }, { cle: 'sc', titre: 'Scénario' }, { cle: 'taux', titre: 'Ventes / jour', num: true, fmt: (v) => CT.fmt.dec(v, 1) }, { cle: 'total', titre: 'Total', num: true, fmt: mn },
      { cle: 'b2c', titre: 'B2C', num: true, fmt: mn }, { cle: 'b2b', titre: 'B2B', num: true, fmt: mn }, { cle: 'att', titre: '% obj.', num: true, fmt: (v) => pc(v, 0) }, { cle: 'comm', titre: 'Comm. agents (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'marge', titre: 'Marge (FCFA)', num: true, fmt: CT.fmt.mnt }],
      pied: { mois: 'TOTAL ' + NOMS[sc], total: t.total, b2c: t.b2c, b2b: t.b2b, att: t.atteinte, comm: t.comm, marge: t.marge } }).el);
    // Contribution par agent : part dans la base historique × total projeté de chaque mois
    const hist = new Map(); baseMois.forEach((b) => vendus(b.cle, b.cle + '-01', b.cle === cle ? au : A.finMois(b.cle)).forEach((l) => hist.set(l.loginKey, (hist.get(l.loginKey) || 0) + 1)));
    const tot = [...hist.values()].reduce((a, b) => a + b, 0);
    const ag = S.agentsPrev = [...hist.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => { const part = tot ? n / tot : 0, o = { login: k, base: n, part }; r.mois.forEach((m, i) => { o['m' + i] = Math.round(m.scenarios[sc].total * part); }); o.total = o.m0 + o.m1 + o.m2; o.comm = o.total * parVente.comm; o.marge = o.total * parVente.marge; return o; });
    $('#pv-ag').append(CT.table.creer({ pageSize: 15, recherche: true, caption: 'Contribution par agent', lignes: ag, colonnes: [{ cle: 'login', titre: 'Agent', fmt: (v) => CT.loginCourt(v) }, { cle: 'base', titre: 'Base hist.', num: true, fmt: mn }, { cle: 'part', titre: 'Part', num: true, fmt: (v) => pc(v) }]
      .concat(r.mois.map((m, i) => ({ cle: 'm' + i, titre: A.libMois(m.cle), num: true, fmt: mn })), [{ cle: 'total', titre: 'Total', num: true, fmt: mn }, { cle: 'comm', titre: 'Comm. agent (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'marge', titre: 'Marge (FCFA)', num: true, fmt: CT.fmt.mnt }]),
      pied: { login: 'TOTAL (' + ag.length + ' agents)', base: tot, part: tot ? 1 : null, m0: CT.somme(ag, (x) => x.m0), m1: CT.somme(ag, (x) => x.m1), m2: CT.somme(ag, (x) => x.m2), total: CT.somme(ag, (x) => x.total), comm: CT.somme(ag, (x) => x.comm), marge: CT.somme(ag, (x) => x.marge) } }).el);
    defiler();
  }

  /* ---------- Navigation, événements ---------- */
  const RENDU = { rgz: rendreRgz, comparaisons: rendreComparaisons, previsions: rendrePrevisions };
  let aDefiler = null;
  /** Défile jusqu'à la section demandée par l'adresse (#rgz/evolution, #comparaisons/wow…) une fois la page construite. */
  function defiler() { if (!aDefiler) return; const el = document.getElementById(aDefiler); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); aDefiler = null; } }
  function rendre() { const v = CT.etat.vue; if (RENDU[v]) RENDU[v](); }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wow],[data-sp],[data-sc]'); if (!b) return;
    if (b.dataset.wow) { S.wowMois = b.dataset.wow; rendreComparaisons(); } else if (b.dataset.sp) { S.spRang = +b.dataset.sp; rendreComparaisons(); }
    else if (b.dataset.sc) { S.scenario = b.dataset.sc; rendrePrevisions(); }
  });
  document.addEventListener('change', (e) => {
    const i = e.target;
    if (i.dataset && i.dataset.pvMois) { const v = +i.value; S.params[i.dataset.pvMois][i.dataset.pvCle] = i.dataset.pvCle === 'croissance' ? Math.max(-50, Math.min(100, v || 0)) : Math.max(0, v || 0); rendrePrevisions(); }
    else if (i.id === 'pv-agents') { S.params.agents = Math.max(1, Math.round(+i.value || 1)); rendrePrevisions(); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest('#pv-reset')) { S.params = {}; rendrePrevisions(); } });
  /* ---------- Exports (barre Excel / PDF / CSV / partage) : mêmes calculs que l'écran, à partir des données chargées ---------- */
  const pcv = (x) => (x == null ? '' : x);
  function feuillesRgz() {
    const d = S.data; if (!d) return [];
    const pr = CT.etat.prioritaire, au = d.au, du = CT.periode.perfDu(), P = { partenaire: pr, statuts: paramsMois(au.slice(0, 7)).statuts }, moisSel = [];
    for (let c = du.slice(0, 7); c <= au.slice(0, 7); c = A.moisDecale(c, 1)) moisSel.push(c);
    const b = A.serie(d.lignes, Object.assign({ du, au, gran: 'mois' }, P)).reduce((a, x) => { a.b2c += x.b2c; a.b2b += x.b2b; a.total += x.total; a.reseau += x.reseau; return a; }, { b2c: 0, b2b: 0, total: 0, reseau: 0 });
    const objs = moisSel.map((c) => paramsMois(c).t), objC = CT.somme(objs, (t) => t.b2c), objB = CT.somme(objs, (t) => t.b2b), objT = objC + objB;
    const cm = moisSel.map((c) => commissions(d.lignes, c, A.finMois(c) < au ? A.finMois(c) : au, du > c + '-01' ? du : c + '-01'));
    const per = 'du ' + CT.date.court(du) + ' au ' + CT.date.court(au), ratio = (a, t) => (t ? a / t : '');
    const objAu = paramsMois(au.slice(0, 7)), ouvRest = A.joursEntre(A.ajouter(au, 1), A.finMois(au.slice(0, 7))).filter(objAu.ouvre).length;
    const al = A.alertes(d.lignes, Object.assign({ au, objectif: { b2c: objAu.t.b2c, b2b: objAu.t.b2b }, ouvresRestants: ouvRest }, P));
    const evo = A.serie(d.lignes, Object.assign({ du, au, gran: gran() }, P)), mois = A.serie(d.lignes, Object.assign({ du: d.mois[0] + '-01', au, gran: 'mois' }, P));
    return [
      { nom: 'Indicateurs ' + pr, cols: [40, 22], total: false, aoa: [['Indicateur', 'Valeur'], ['Période', per], ['Ventes ' + pr, b.total], ['B2C', b.b2c], ['B2B', b.b2b], ['Taux B2B', ratio(b.b2b, b.total)], ['Objectif taux B2B', ratio(objB, objT)],
        ['Taux B2C', ratio(b.b2c, b.total)], ['Objectif taux B2C', ratio(objC, objT)], ['Total réseau (ventes Celtiis)', b.reseau], ['Part de marché ' + pr, ratio(b.total, b.reseau)], ['Commissions agents (FCFA)', CT.somme(cm, (x) => x.agents)], ['Marge ' + pr + ' (FCFA)', CT.somme(cm, (x) => x.marge)]] },
      { nom: 'Progression objectifs', cols: [14, 14, 14, 18, 14], total: false, aoa: [['Segment', 'Objectif', 'Réalisé', 'Taux d\'atteinte', 'Manquant']].concat([['B2C', objC, b.b2c], ['B2B', objB, b.b2b], ['TOTAL', objT, b.total]].map(([l, o, r]) => [l, o, r, ratio(r, o), Math.max(0, o - r)])) },
      { nom: 'Ventes par mois', cols: [18, 10, 10, 10, 12, 16], total: false, aoa: [['Mois', 'B2C', 'B2B', 'Total', 'Réseau', 'Part de marché']].concat(mois.map((x) => [x.lib, x.b2c, x.b2b, x.total, x.reseau, pcv(x.pdm)])) },
      { nom: 'Évolution (' + gran() + ')', cols: [20, 12, 12, 10, 10, 10, 10, 14, 16], aoa: [['Période', 'Du', 'Au', 'B2C', 'B2B', 'Total', 'Réseau', 'Taux B2B', 'Part de marché']].concat(evo.map((x) => [x.lib, x.du, x.au, x.b2c, x.b2b, x.total, x.reseau, pcv(x.ratioB2B), pcv(x.pdm)])) },
      { nom: 'Alertes', cols: [10, 70, 110], total: false, aoa: [['Niveau', 'Alerte', 'Recommandation']].concat(al.map((a) => [{ pos: 'Positif', warn: 'À surveiller', neg: 'Critique', info: 'Info' }[a.niveau], a.titre, a.detail])) }];
  }
  function feuillesComparaisons() {
    const d = S.data; if (!d) return [];
    const pr = CT.etat.prioritaire, au = d.au, cle = au.slice(0, 7), pm = paramsMois(cle), P = { partenaire: pr, statuts: pm.statuts };
    const dod = A.dayOnDay(d.lignes, Object.assign({ au, n: 7, objectifJour: pm.t.jour }, P)).jours, objectifs = {}; d.mois.forEach((c) => { objectifs[c] = paramsMois(c).t.mois; });
    const wow = d.mois.map((c) => [c, A.weekOnWeek(d.lignes, Object.assign({ cle: c, au, objectifMois: paramsMois(c).t.mois }, P))]);
    const mom = A.monthOnMonth(d.lignes, Object.assign({ mois: d.mois, au, objectifs }, P));
    const sp = [1, 2, 3, 4, 5].flatMap((r) => A.samePeriod(d.lignes, Object.assign({ mois: d.mois, au, rang: r }, P)).map((x) => ['S' + r, x]));
    const gap = A.gapObjectifs(d.lignes, Object.assign({ du: cle + '-01', au, objectifJour: pm.t.jour, objectifSemaine: pm.t.semaine, estOuvre: pm.ouvre }, P));
    return [
      { nom: 'Day on Day', cols: [12, 10, 10, 10, 12, 16, 18], total: false, aoa: [['Jour', 'Ventes', 'B2C', 'B2B', 'Veille', 'Évolution vs veille', 'Taux objectif du jour']].concat(dod.map((x) => [CT.date.court(x.jour), x.total, x.b2c, x.b2b, x.veille, pcv(x.evol), pm.ouvre(x.jour) ? pcv(x.tauxObjectif) : 'non ouvré'])) },
      { nom: 'Week on Week', cols: [18, 8, 18, 12, 8, 10, 14, 10, 10, 10, 16], total: false, aoa: [['Mois', 'Semaine', 'Libellé', 'Du', 'Jours', 'Ventes', 'Évolution vs sem. préc.', 'B2C', 'B2B', 'Réseau', 'Part de marché']]
        .concat(...wow.map(([c, w]) => w.semaines.map((x) => [A.libMois(c), x.rang, x.lib, x.du, x.jours, x.total, pcv(x.evol), x.b2c, x.b2b, x.reseau, pcv(x.pdm)]).concat([[A.libMois(c), 'TOTAL', w.objectifMois ? 'Objectif ' + w.objectifMois : '', '', '', w.total.total, '', w.total.b2c, w.total.b2b, w.total.reseau, pcv(w.total.pdm)]]))) },
      { nom: 'Month on Month', cols: [18, 10, 14, 14, 16, 10, 10, 10, 16, 12, 16], total: false, aoa: [['Mois', 'Ventes', 'Évolution', 'À date égale', 'Évolution à date égale', 'B2C', 'B2B', 'Réseau', 'Part de marché', 'Objectif', 'Taux d\'atteinte']]
        .concat(mom.map((x) => [x.lib + (x.complet ? '' : ' (en cours)'), x.total, pcv(x.evol), x.aDate, pcv(x.evolADate), x.b2c, x.b2b, x.reseau, pcv(x.pdm), x.objectif, pcv(x.tro)])) },
      { nom: 'Same Period', cols: [8, 18, 12, 12, 10, 10, 10, 10, 18], total: false, aoa: [['Semaine du mois', 'Mois', 'Du', 'Au', 'Ventes', 'B2C', 'B2B', 'Réseau', 'Écart vs mois préc.']].concat(sp.map(([r, x]) => [r, x.lib, x.du, x.au || 'pas encore écoulée', x.disponible ? x.total : '', x.disponible ? x.b2c : '', x.disponible ? x.b2b : '', x.disponible ? x.reseau : '', pcv(x.ecart)])) },
      { nom: 'Écart objectifs jours', cols: [14, 10, 12, 16, 10], total: false, aoa: [['Jour ouvré', 'Ventes', 'Objectif', 'Taux d\'atteinte', 'Écart']].concat(gap.jours.map((x) => [CT.date.court(x.jour), x.ventes, x.objectif, pcv(x.taux), x.ecart])) },
      { nom: 'Écart objectifs semaines', cols: [18, 12, 10, 12, 16, 10], total: false, aoa: [['Semaine', 'Jours ouvrés', 'Ventes', 'Objectif', 'Taux d\'atteinte', 'Écart']].concat(gap.semaines.map((x) => [x.lib, x.ouvres, x.ventes, x.objectif, pcv(x.taux), x.ecart])) }];
  }
  function feuillesPrevisions() {
    const z = S.dernierePrev; if (!z) return [];
    const { r, sc, NOMS } = z, L = [];
    r.mois.forEach((m) => Object.entries(NOMS).forEach(([k, n]) => { const x = m.scenarios[k]; L.push([A.libMois(m.cle), (k === sc ? '▶ ' : '') + n, Math.round(x.taux * 10) / 10, x.total, x.b2c, x.b2b, pcv(x.atteinte), Math.round(x.comm), Math.round(x.marge)]); }));
    const t = r.totaux[sc], ag = S.agentsPrev || [];
    return [
      { nom: 'Scénarios', cols: [18, 14, 14, 10, 10, 10, 16, 20, 18], total: false, aoa: [['Mois', 'Scénario', 'Ventes par jour', 'Total', 'B2C', 'B2B', 'Taux d\'atteinte', 'Comm. agents (FCFA)', 'Marge (FCFA)']].concat(L, [['TOTAL ' + NOMS[sc], '', '', t.total, t.b2c, t.b2b, pcv(t.atteinte), Math.round(t.comm), Math.round(t.marge)]]) },
      { nom: 'Paramètres', cols: [18, 14, 14, 14, 14, 12], total: false, aoa: [['Mois', 'Jours ouvrés', 'Croissance (%)', 'Objectif B2C', 'Objectif B2B', 'Agents']].concat(r.mois.map((m) => [A.libMois(m.cle), m.ouvres, m.croissance, m.objB2C, m.objB2B, m.agents]), [['Base : ventes par agent et par jour', Math.round(r.basePerAgent * 1000) / 1000]]) },
      { nom: 'Contribution par agent', cols: [26, 12, 10].concat(r.mois.map(() => 16), [10, 20, 18]), total: false, aoa: [['Agent', 'Base hist.', 'Part (taux)'].concat(r.mois.map((m) => A.libMois(m.cle)), ['Total', 'Comm. agent (FCFA)', 'Marge (FCFA)'])]
        .concat(ag.map((x) => [x.login, x.base, x.part].concat(r.mois.map((_, i) => x['m' + i]), [x.total, Math.round(x.comm), Math.round(x.marge)])), [['TOTAL', CT.somme(ag, (x) => x.base), ''].concat(r.mois.map((_, i) => CT.somme(ag, (x) => x['m' + i])), [CT.somme(ag, (x) => x.total), Math.round(CT.somme(ag, (x) => x.comm)), Math.round(CT.somme(ag, (x) => x.marge))])]) }];
  }
  const MODS = { comparaisons: ['Comparaisons', feuillesComparaisons], previsions: ['Prévisions', feuillesPrevisions] };
  function module(vue) {
    const m = MODS[vue]; if (!m) return null;
    const feuilles = () => { let f = []; try { f = m[1]() || []; } catch (er) { f = []; } return f.length ? f : [{ nom: m[0], total: false, aoa: [['Information'], ['Ouvrez la page pour calculer les données, puis relancez l\'export.']] }]; };
    const resume = () => { const f = feuilles()[0]; return m[0] + ' — au ' + CT.date.court(CT.etat.jourRef) + '\n' + f.aoa.slice(1, 12).map((r) => '• ' + r.filter((v) => v !== '' && v != null).map((v) => (typeof v === 'number' ? (Math.abs(v) < 1.5 && !Number.isInteger(v) ? CT.fmt.pct(v, 0) : CT.fmt.int(v)) : String(v))).join(' : ')).join('\n'); };
    return { titre: m[0], nom: m[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '_'), feuilles, resume };
  }
  CT.analyse = { donnees, fenetre, graphe, palette, jeton, paramsMois, kpi, carte, boutons };
  CT.analyseUI = { VUES, module, feuillesRgz: () => { try { return feuillesRgz(); } catch (er) { return []; } }, feuillesGlobales: () => { try { return feuillesComparaisons(); } catch (er) { return []; } }, surVue: rendre, rafraichir: () => { S.cle = null; S.data = null; if (RENDU[CT.etat.vue]) rendre(); }, allerA: () => { window.scrollTo({ top: 0 }); }, etat: S };
})();
