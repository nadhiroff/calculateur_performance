/* ============================================================================
   perf_partenaire.js — rapport « Performance » en rubriques : RGZ en bref, ventes B2B, ventes B2C,
   commissions & primes, objectifs ; les autres partenaires se consultent un par un (jamais mélangés à RGZ).
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const E = () => CT.etat;
  let charts = {};
  function chart(id, cfg) {
    const cv = document.getElementById(id); if (!cv || !window.Chart) return;
    if (charts[id]) charts[id].destroy();
    const cs = getComputedStyle(document.documentElement);
    Chart.defaults.color = cs.getPropertyValue('--text-2').trim(); Chart.defaults.borderColor = cs.getPropertyValue('--border').trim();
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {});
    charts[id] = new Chart(cv, cfg);
  }


  /* Tableau condensé « Performance par login » : mise en page fixe, aucune barre de défilement */
  function rendreLogin(e) {
    const pl = e.perfLogin, f = (document.getElementById('pf-eq-filter') || {}).value || '';
    const mn = (n) => CT.fmt.mnt(n), sj = (r) => (r.objMois > 0 ? CT.fmt.int(r.objSemaine) + ' / ' + CT.fmt.int(r.objJour) : 'n/a');
    const tx = (r) => (r.taux == null ? 'n/a' : '<span class="' + (r.taux >= 1 ? 'txt-pos' : '') + '">' + CT.fmt.pct(r.taux, 0) + '</span>');
    const cells = (r, premier) => `${premier}<td class="num">${CT.fmt.int(r.b2b)}</td><td class="num">${CT.fmt.int(r.b2c)}</td><td class="num hide-sm">${sj(r)}</td><td class="num">${tx(r)}</td>
      <td class="num hide-sm">${mn(r.oneShotB2B)}</td><td class="num hide-sm">${mn(r.oneShotB2C)}</td><td class="num"><b>${mn(r.oneShot)}</b></td><td class="num">${mn(r.partCommercial)}</td><td class="num">${mn(r.partRgz)}</td>`;
    let body = '';
    pl.equipes.filter((q) => !f || q.id === f).forEach((q) => {
      body += '<tr class="row-team">' + cells(q, `<td class="login">${CT.esc(q.id)}${q.superviseur ? ' <span class="muted">· ' + CT.esc(q.superviseur) + '</span>' : ''}</td>`) + `<td class="hide-md"></td><td class="num hide-md">${mn(q.primesPlan)}</td></tr>`;
      q.rows.forEach((r) => {
        body += '<tr' + (r.horsObjectif ? ' class="row-hors"' : '') + '>' + cells(r, `<td class="login" title="${CT.esc(r.login)}">${CT.esc(r.loginCourt)}${r.horsObjectif ? ' <span class="badge badge-warn">hors objectif</span>' : ''}</td>`) +
          `<td class="hide-md">${r.palier === 'Aucun' ? '<span class="muted">Aucun</span>' : CT.esc(r.palier)}</td><td class="num hide-md">${mn(r.primesPlan)}</td></tr>`;
      });
    });
    const t = f ? pl.equipes.find((q) => q.id === f) : pl.total;
    const foot = '<tr class="row-total">' + cells(t, `<td class="login">${f ? 'TOTAL ' + CT.esc(f) : 'TOTAL ' + CT.esc(pl.partenaire)}</td>`) + `<td class="hide-md"></td><td class="num hide-md">${mn(t.primesPlan)}</td></tr>`;
    document.getElementById('pf-login').innerHTML = `<div class="table-wrap"><table class="table-compact"><caption class="sr-only">Performance par login : One-Shot et commissions</caption>
      <colgroup><col style="width:17%"><col style="width:5%"><col style="width:5%"><col class="hide-sm" style="width:9%"><col style="width:7%"><col class="hide-sm" style="width:9%"><col class="hide-sm" style="width:9%"><col style="width:10%"><col style="width:10%"><col style="width:9%"><col class="hide-md" style="width:5%"><col class="hide-md" style="width:5%"></colgroup>
      <thead><tr><th scope="col">Équipe / Login</th><th scope="col" class="num">B2B vendus</th><th scope="col" class="num">B2C vendus</th><th scope="col" class="num hide-sm">Obj. sem. / jour</th><th scope="col" class="num">Réalis.</th>
      <th scope="col" class="num hide-sm">One-Shot B2B</th><th scope="col" class="num hide-sm">One-Shot B2C</th><th scope="col" class="num">Total One-Shot</th><th scope="col" class="num">Part commercial</th><th scope="col" class="num">Part ${CT.esc(pl.partenaire)}</th>
      <th scope="col" class="hide-md">Palier</th><th scope="col" class="num hide-md">Primes plan</th></tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
  }

  /* Historique mensuel d'un partenaire : mois passés pleins, mois en cours = projection (barre claire), mois futurs vides */
  function histogramme(id, nom, r, p, couleur) {
    const mi = p.moisIndex, data = p.labelsHisto.map((_, i) => (i === mi ? Math.round(r.projection || 0) : i > mi ? null : r.histo[i] || 0));
    chart(id, { type: 'bar', data: { labels: p.labelsHisto.map((x, i) => (i === mi ? x + ' (proj.)' : x)), datasets: [{ label: nom, data,
      backgroundColor: p.labelsHisto.map((_, i) => (i === mi ? couleur + '88' : couleur)), borderRadius: 4, maxBarThickness: 26 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + CT.fmt.int(c.parsed.y) + (c.dataIndex === mi ? ' (projection fin de mois)' : ' ventes') } } }, scales: { y: { beginAtZero: true } } } });
  }

  /* Comparatif de tous les partenaires (replié par défaut dans « Autres partenaires ») */
  function rendreComparatif(zone, ctx) {
    const { e, p, debutP, partielle, pr } = ctx;
    zone.innerHTML = `<section><h4>Classement des partenaires</h4><p class="mini-cap">Ventes OK du ${CT.date.court(debutP)} au ${CT.date.court(e.jourRef)} · projection = rythme actuel sur ${p.nbOuvres} jours ouvrés · évolution vs ${p.labelsHisto[p.moisIndex - 1] || 'mois précédent'}</p><div id="pf-rank"></div></section>
      <section><h4>Part de marché — top 10</h4><div class="chart-box tall"><canvas id="pf-ch-part" role="img" aria-label="Part de marché des partenaires"></canvas></div></section>
      <section><h4>Historique mensuel par partenaire</h4><div id="pf-histo"></div></section>
      <section><h4>Meilleurs vendeurs — tous partenaires</h4><div class="grid-3" id="pf-logins"></div></section>`;
    const evo = (v) => (v == null ? '—' : `<span class="badge ${v >= 0 ? 'badge-pos' : 'badge-neg'}">${v >= 0 ? '+' : ''}${CT.fmt.pct(v, 0)}</span>`);
    const signe = (v) => (v > 0 ? '+' : '') + CT.fmt.int(v);
    zone.querySelector('#pf-rank').append(CT.table.creer({ pageSize: 0, caption: 'Classement des partenaires', lignes: p.rows, classeLigne: (r) => (r.prioritaire ? 'row-rgz' : ''),
      colonnes: [{ cle: 'rang', titre: 'Rang', num: true }, { cle: 'partenaire', titre: 'Partenaire' }, { cle: 'ventes', titre: 'Ventes OK', num: true, fmt: CT.fmt.int }, { cle: 'b2c', titre: 'B2C', num: true, fmt: CT.fmt.int }, { cle: 'b2b', titre: 'B2B', num: true, fmt: CT.fmt.int },
        { cle: 'attente', titre: 'En attente', num: true, fmt: CT.fmt.int }, { cle: 'ca', titre: 'CA (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'part', titre: 'Part de marché', num: true, fmt: (v) => CT.fmt.pct(v, 1) },
        { cle: 'precedent', titre: p.labelsHisto[p.moisIndex - 1] || 'Mois préc.', num: true, fmt: CT.fmt.int }, { cle: 'projection', titre: 'Projection fin de mois', num: true, fmt: CT.fmt.int },
        { cle: 'ecartPrec', titre: 'Écart vs préc.', num: true, fmt: signe }, { cle: 'evolution', titre: 'Évolution', num: true, html: true, fmt: (v, r) => (r.nouveau ? '<span class="badge badge-info">Nouveau</span>' : evo(v == null ? 0 : v)) },
        { cle: 'commission', titre: 'Commission estimée (FCFA)', num: true, fmt: CT.fmt.mnt }],
      pied: { rang: '', partenaire: 'TOTAL', ventes: p.total.ventes, b2c: p.total.b2c, b2b: p.total.b2b, attente: p.total.attente, ca: p.total.ca, part: 1, precedent: p.total.precedent, projection: p.total.projection, ecartPrec: p.total.ecartPrec, evolution: p.total.evolution, commission: p.total.commission } }).el);
    const mois = p.labelsHisto;
    const hl = p.rows.map((r) => { const o = { partenaire: r.partenaire, prioritaire: r.prioritaire, courant: r.ventesDernier != null ? r.ventesDernier : r.ventes, proj: r.projection || 0 }; mois.forEach((_, i) => { o['m' + i] = r.histo[i] || 0; }); return o; });
    zone.querySelector('#pf-histo').append(CT.table.creer({ pageSize: 15, recherche: true, caption: 'Historique mensuel par partenaire', lignes: hl, classeLigne: (r) => (r.prioritaire ? 'row-rgz' : ''),
      colonnes: [{ cle: 'partenaire', titre: 'Partenaire' }].concat(mois.map((x, i) => ({ cle: 'm' + i, titre: x, num: true, fmt: CT.fmt.int })), [{ cle: 'courant', titre: CT.date.MOIS[p.moisIndex].replace(/^./, (c) => c.toUpperCase()) + (partielle ? ' (période)' : ' (cumul)'), num: true, fmt: CT.fmt.int }, { cle: 'proj', titre: 'Projection', num: true, fmt: CT.fmt.int }]) }).el);
    // Meilleurs vendeurs tous partenaires : B2B, B2C, total
    const ok = e.lignes.filter((l) => l.statut === 'OK' && l.jour && l.jour >= debutP && l.jour <= e.jourRef);
    const partDe = new Map(ok.map((l) => [l.loginKey, l.partenaire]));
    const top = (f, n) => CT.calc.grouper(ok.filter(f), (l) => l.loginKey).slice(0, n);
    const bloc = (titre, rows, col) => { const d = CT.h('div', {}, CT.h('h5', {}, titre)); d.append(CT.table.creer({ pageSize: 0, caption: titre, classeLigne: (r) => (partDe.get(r.login) === pr ? 'row-rgz' : ''),
      lignes: rows.map((g, i) => ({ rang: i + 1, login: g.cle, partenaire: partDe.get(g.cle), n: g.n })), colonnes: [{ cle: 'rang', titre: 'N°', num: true }, { cle: 'login', titre: 'Login', fmt: (v) => CT.loginCourt(v) }, { cle: 'partenaire', titre: 'Partenaire' }, { cle: 'n', titre: col, num: true }],
      pied: { rang: '', login: 'Total', partenaire: '', n: CT.somme(rows, (g) => g.n) } }).el); return d; };
    zone.querySelector('#pf-logins').append(bloc('Top 10 B2B', top((l) => l.segment === 'B2B', 10), 'B2B'), bloc('Top 10 B2C', top((l) => l.segment !== 'B2B', 10), 'B2C'), bloc('Top 20 toutes ventes', top(() => true, 20), 'Ventes'));
    const top10 = p.rows.filter((r) => r.ventes > 0).slice(0, 10), cs = getComputedStyle(document.documentElement), bleu = cs.getPropertyValue('--series-1').trim(), ambre = cs.getPropertyValue('--accent-rgz').trim();
    chart('pf-ch-part', { type: 'bar', data: { labels: top10.map((r) => r.partenaire), datasets: [{ label: 'Part de marché', data: top10.map((r) => +(r.part * 100).toFixed(1)), backgroundColor: top10.map((r) => (r.prioritaire ? ambre : bleu)), borderRadius: 4, maxBarThickness: 22 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + c.parsed.x + ' %' } } }, scales: { x: { ticks: { callback: (v) => v + ' %' } } } } });
  }

  /* Ventes d'un segment (B2B ou B2C) : objectifs, réalisé, commissions par équipe + meilleurs vendeurs du segment */
  function rubriqueSegment(zone, ctx, seg) {
    const { e, m, cp, pr, lignesPr, oe, nbO, partielle } = ctx, mn = CT.fmt.int, B = seg === 'B2B';
    const nomSeg = B ? 'B2B (entreprises)' : 'B2C (particuliers)', cleObj = B ? 'objB2B' : 'objB2C', cleReal = B ? 'realB2B' : 'realB2C';
    const prorata = (o) => (partielle ? Math.round((o * oe) / nbO) : o);   // période partielle : objectif au prorata des jours ouvrés
    const rows = m.equipes.map((q) => { const c = cp.equipes.find((x) => x.id === q.id) || {}; const obj = m.multiMois ? q[cleObj + 'Periode'] : prorata(q[cleObj]);
      return { id: q.id, obj, objMois: q[cleObj], real: q[cleReal], taux: obj > 0 ? q[cleReal] / obj : null, com: B ? c.comB2B || 0 : c.comB2C || 0,
        vendeurs: B ? c.comB2BVendeurs || 0 : c.comB2CVendeurs || 0, partenaire: B ? c.comB2BRgz || 0 : c.comB2CRgz || 0, prime: B ? c.primeB2BVendeurs || 0 : c.primeB2CVendeurs || 0, anonymat: c.anonymat }; });
    const real = CT.somme(m.agents, (a) => a[cleReal]), obj = CT.somme(rows, (x) => x.obj), taux = obj > 0 ? real / obj : null;
    const com = CT.somme(rows, (x) => x.com), prime = CT.somme(rows, (x) => x.prime);
    const top = CT.calc.grouper(lignesPr.filter((l) => (l.segment === 'B2B') === B), (l) => l.loginKey).slice(0, 10), max = top.length ? top[0].n : 1;
    const idx = CT.objectifs.indexLogins(m.objectifs);
    zone.innerHTML = `<div class="stack">${CT.ui.enClair(`Ventes <b>${nomSeg}</b> de ${CT.esc(pr)} : <b>${mn(real)}</b> sur un objectif de <b>${mn(obj)}</b>${partielle ? ' (au prorata de la période)' : ' pour le mois'}, soit <b>${CT.fmt.pct(taux, 0)}</b>. Elles rapportent <b>${CT.fmt.fcfa(com)}</b> de commissions (${CT.fmt.int(B ? m.comm.b2b : m.comm.b2c)} FCFA par vente).`, B ? 'fa-building' : 'fa-house-user')}
      <div class="grid-tuiles">
        ${CT.ui.tuile({ icone: B ? 'fa-building' : 'fa-house-user', ton: CT.ui.tonDe(taux), titre: 'Ventes ' + seg, valeur: mn(real) + ' / ' + mn(obj), p: taux || 0, aide: CT.fmt.pct(taux, 0) + ' de l\'objectif ' + seg })}
        ${CT.ui.tuile({ icone: 'fa-coins', ton: 'pos', titre: 'Commissions ' + seg, valeur: CT.fmt.fcfa(com), aide: 'Vendeurs ' + CT.fmt.fcfa(CT.somme(rows, (x) => x.vendeurs)) + ' · ' + CT.esc(pr) + ' ' + CT.fmt.fcfa(CT.somme(rows, (x) => x.partenaire)) })}
        ${CT.ui.tuile({ icone: 'fa-medal', ton: 'warn', titre: 'Primes ' + seg + ' vendeurs', valeur: CT.fmt.fcfa(prime), aide: B ? m.agents.filter((a) => a.bonusB2B > 0).length + ' vendeur(s) avec le bonus B2B' : 'Journées, champion et paliers' })}
        ${CT.ui.tuile({ icone: 'fa-people-group', ton: '', titre: 'Équipes à l\'objectif ' + seg, valeur: rows.filter((x) => x.taux != null && x.taux >= 1).length + ' / ' + rows.filter((x) => x.obj > 0).length, aide: 'Équipes ayant un objectif ' + seg })}
      </div>
      <div class="grid-3-1">
        <section class="card"><div class="card-head"><div><h3>Équipes — ventes ${seg}</h3><p>Objectif ${partielle ? 'au prorata de la période' : 'du mois'}, réalisé et commissions</p></div></div><div id="pf-seg-eq"></div></section>
        <section class="card"><div class="card-head"><div><h3>Top 10 vendeurs ${seg}</h3><p>${CT.esc(pr)} uniquement</p></div></div><ol class="rank">${top.map((g, i) => `<li><span class="pos-n">${i + 1}</span><div><div class="nm">${CT.esc(CT.loginCourt(g.cle))} <small class="muted">· ${CT.esc((idx.get(g.cle) || {}).equipe || 'À préciser')}</small></div><div class="bar" aria-hidden="true"><span style="width:${(g.n / max) * 100}%"></span></div></div><div class="text-right"><b class="num">${mn(g.n)}</b><small class="muted">${seg}</small></div></li>`).join('') || '<p class="muted">Aucune vente ' + seg + '.</p>'}</ol></section>
      </div></div>`;
    zone.querySelector('#pf-seg-eq').append(CT.table.creer({ pageSize: 0, caption: 'Ventes ' + seg + ' par équipe', lignes: rows, triInit: { cle: 'real', dir: 'desc' }, classeLigne: (x) => (x.anonymat ? 'row-hors' : ''),
      colonnes: [{ cle: 'id', titre: 'Équipe' }, { cle: 'obj', titre: partielle ? 'Objectif période' : 'Objectif mois', num: true, fmt: mn }, { cle: 'real', titre: 'Réalisé', num: true, fmt: mn },
        { cle: 'taux', titre: 'Réalisation', html: true, tri: (x) => x.taux || 0, fmt: (v) => (v == null ? '<span class="muted">pas d\'objectif</span>' : `<div class="cellule-jauge">${CT.ui.jauge(v)}<span class="num">${CT.fmt.pct(v, 0)}</span></div>`) },
        { cle: 'com', titre: 'Commissions (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'vendeurs', titre: 'Part vendeurs', num: true, fmt: CT.fmt.mnt }, { cle: 'partenaire', titre: 'Part ' + pr, num: true, fmt: CT.fmt.mnt }, { cle: 'prime', titre: 'Primes vendeurs', num: true, fmt: CT.fmt.mnt }],
      pied: { id: 'TOTAL', obj, real, taux: '', com, vendeurs: CT.somme(rows, (x) => x.vendeurs), partenaire: CT.somme(rows, (x) => x.partenaire), prime } }).el);
  }

  /* Un autre partenaire, seul : ses chiffres, son historique, ses vendeurs (jamais mélangé avec RGZ) */
  function rendrePartenaire(zone, ctx, nom) {
    const { e, p, debutP } = ctx, mn = CT.fmt.int, x = p.rows.find((r) => r.partenaire === nom);
    if (!x) { zone.innerHTML = '<p class="muted">Aucune donnée pour ce partenaire.</p>'; return; }
    const L = e.lignes.filter((l) => l.partenaire === nom && l.statut === 'OK' && l.jour && l.jour >= debutP && l.jour <= e.jourRef);
    const top = CT.calc.grouper(L, (l) => l.loginKey).slice(0, 10), max = top.length ? top[0].n : 1;
    zone.innerHTML = `${CT.ui.enClair(`<b>${CT.esc(nom)}</b> a fait <b>${mn(x.ventes)} vente(s) validée(s)</b> du ${CT.date.court(debutP)} au ${CT.date.court(e.jourRef)} (${mn(x.b2c)} B2C, ${mn(x.b2b)} B2B) avec ${mn(x.nbLogins)} vendeur(s). `
        + (x.nouveau ? 'Nouveau partenaire ce mois-ci.' : x.evolution == null ? '' : `Au rythme actuel : <b>${mn(x.projection)}</b> ventes en fin de mois, ${x.evolution >= 0 ? 'en hausse' : 'en baisse'} de <b>${CT.fmt.pct(Math.abs(x.evolution), 0)}</b> par rapport au mois précédent (${mn(x.precedent)}).`), 'fa-handshake')}
      <div class="grid-tuiles">
        ${CT.ui.tuile({ icone: 'fa-file-signature', titre: 'Ventes validées', valeur: mn(x.ventes), aide: mn(x.b2c) + ' B2C · ' + mn(x.b2b) + ' B2B' })}
        ${CT.ui.tuile({ icone: 'fa-ranking-star', ton: 'warn', titre: 'Rang', valeur: x.rang + ' / ' + p.rows.filter((r) => r.ventes > 0).length, aide: 'Part de marché ' + CT.fmt.pct(x.part, 1) })}
        ${CT.ui.tuile({ icone: 'fa-chart-line', ton: x.evolution == null ? 'info' : x.evolution >= 0 ? 'pos' : 'neg', titre: 'Projection fin de mois', valeur: mn(x.projection), aide: x.nouveau ? 'Nouveau ce mois' : 'Mois précédent : ' + mn(x.precedent) })}
        ${CT.ui.tuile({ icone: 'fa-coins', ton: 'pos', titre: 'CA validé', valeur: CT.fmt.fcfa(x.ca), aide: mn(x.attente) + ' vente(s) en attente' })}
      </div>
      <div class="grid-2">
        <section class="card"><div class="card-head"><div><h3>Historique de ${CT.esc(nom)}</h3><p>Ventes mensuelles (mois en cours = projection)</p></div></div><div class="chart-box"><canvas id="pf-ch-part-seul" role="img" aria-label="Historique de ${CT.esc(nom)}"></canvas></div></section>
        <section class="card"><div class="card-head"><div><h3>Meilleurs vendeurs de ${CT.esc(nom)}</h3><p>Ventes validées de la période</p></div></div><ol class="rank">${top.map((g, i) => `<li><span class="pos-n">${i + 1}</span><div><div class="nm">${CT.esc(CT.loginCourt(g.cle))}</div><div class="bar" aria-hidden="true"><span style="width:${(g.n / max) * 100}%"></span></div></div><div class="text-right"><b class="num">${mn(g.n)}</b><small class="muted">ventes</small></div></li>`).join('') || '<p class="muted">Aucune vente validée.</p>'}</ol></section>
      </div>`;
    const bleu = getComputedStyle(document.documentElement).getPropertyValue('--series-1').trim();
    histogramme('pf-ch-part-seul', nom, x, p, bleu);
  }

  CT.perf = {
    render() {
      const e = E(), root = document.getElementById('perf-content');
      if (!e.lignes.length) { root.innerHTML = ''; return; }

      // La période (début → fin) est calculée une seule fois dans app.js : mêmes chiffres à l'écran et dans les exports
      const p = e.perf, m = e.motivPerf, partielle = CT.periode.perfPartielle(), debutP = CT.periode.perfDu();
      const pr = e.prioritaire, rg = p.rows.find((r) => r.partenaire === pr) || { ventes: 0, b2c: 0, b2b: 0, commission: 0, part: 0, projection: 0, ca: 0, histo: [] };
      const objMois = m.reseau.objMois, objADate = m.reseau.objADate, ecart = rg.ventes - objADate, mn = CT.fmt.int;
      // Plusieurs mois : la projection porte sur le dernier mois, comparée à SON objectif
      const multi = !!m.multiMois, dernier = multi ? m.segments[m.segments.length - 1] : m, objDernier = dernier.reseau.objMois, nomDernier = CT.date.MOIS[+e.cle.slice(5, 7) - 1], deDernier = (/^[aeiouy]/i.test(nomDernier) ? 'd\'' : 'de ') + nomDernier;
      // Commissions, primes et coût du plan : calcul commun de la période (app.js), identique au Point du jour et au tableau RGZ
      const b = e.budgetPeriode, cp = e.primesPeriode; e.primesPerf = cp;
      const lignesPr = e.lignes.filter((l) => l.partenaire === pr && l.statut === 'OK' && l.jour && l.jour >= debutP && l.jour <= e.jourRef);
      const ctx = { e, p, m, cp, pr, lignesPr, debutP, partielle, oe: m.ouvresEcoules, nbO: m.nbOuvres };
      const autres = p.rows.filter((r) => r.partenaire !== pr && (r.ventes > 0 || r.precedent > 0));
      const periodeTxt = multi ? 'période ' + CT.periode.perf() : CT.date.libelleMois(e.cle) + ' — ' + (partielle ? 'période ' + CT.periode.perf() : 'du 1er au ' + CT.date.court(e.jourRef));

      const RUBRIQUES = {
        apercu(zone) {
          zone.innerHTML = `<div class="stack">${CT.ui.enClair(`${CT.esc(pr)} est <b>n°${rg.rang || '—'}</b> des partenaires avec <b>${mn(rg.ventes)}</b> ventes validées (${periodeTxt}). C'est <b>${CT.fmt.pct(objMois ? rg.ventes / objMois : 0, 0)}</b> ${multi ? 'des objectifs des mois de la période' : 'de l\'objectif du mois'} ; au rythme actuel, ${CT.esc(pr)} finira ${multi ? nomDernier : 'le mois'} à environ <b>${mn(rg.projection)}</b> ventes.`, 'fa-star')}
            <div class="grid-tuiles">
              ${CT.ui.tuile({ icone: 'fa-ranking-star', ton: 'warn', titre: 'Rang ' + CT.esc(pr), valeur: rg.rang ? rg.rang + ' / ' + p.rows.filter((r) => r.ventes > 0).length : '—', aide: 'Part de marché ' + CT.fmt.pct(rg.part, 1) })}
              ${CT.ui.tuile({ icone: 'fa-file-signature', titre: 'Ventes ' + CT.esc(pr), valeur: mn(rg.ventes), aide: mn(rg.b2c) + ' B2C · ' + mn(rg.b2b) + ' B2B' })}
              ${CT.ui.tuile({ icone: 'fa-bullseye', ton: ecart >= 0 ? 'pos' : 'neg', titre: ecart >= 0 ? 'En avance sur l\'objectif' : 'En retard sur l\'objectif', valeur: (ecart >= 0 ? '+' : '') + mn(ecart), p: objADate ? rg.ventes / objADate : 0, aide: mn(objADate) + ' ventes attendues à date' })}
              ${CT.ui.tuile({ icone: 'fa-chart-line', ton: 'info', titre: multi ? 'Projection fin ' + nomDernier : 'Projection fin de mois', valeur: mn(rg.projection), p: objDernier ? rg.projection / objDernier : 0, aide: CT.fmt.pct(objDernier ? rg.projection / objDernier : 0) + ' de l\'objectif ' + (multi ? deDernier : 'du mois') })}
              ${CT.ui.tuile({ icone: 'fa-coins', ton: 'pos', titre: 'Commissions', valeur: CT.fmt.fcfa(cp.total.commissions), aide: 'Dont ' + CT.fmt.fcfa(cp.total.partenaire) + ' pour ' + CT.esc(pr) })}
              ${CT.ui.tuile({ icone: 'fa-scale-balanced', ton: b.ratio != null && b.ratio < 0.5 ? 'pos' : 'warn', titre: 'Coût du plan / marge', valeur: b.ratio == null ? '—' : CT.fmt.pct(b.ratio, 0), aide: CT.fmt.fcfa(b.cout) + ' de primes pour ' + CT.fmt.fcfa(b.marge) + ' de marge' })}
            </div>
            <section class="card"><div class="card-head"><div><h3>Historique de ${CT.esc(pr)}</h3><p>Ventes mensuelles (mois en cours = projection)</p></div></div><div class="chart-box"><canvas id="pf-ch-histo" role="img" aria-label="Historique mensuel de ${CT.esc(pr)}"></canvas></div></section></div>`;
          const ambre = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgz').trim();
          histogramme('pf-ch-histo', pr, rg, p, ambre);
        },
        b2b(zone) { rubriqueSegment(zone, ctx, 'B2B'); },
        b2c(zone) { rubriqueSegment(zone, ctx, 'B2C'); },
        commissions(zone) {
          const t = cp.total, pot = cp.potentiel, aVerser = t.vendeurs + CT.somme(cp.equipes, (q) => q.primeEquipe + q.primeObjectif);
          const proches = dernier.agents.filter((x) => x.primes && x.objMois > 0).map((x) => { const pal = [...m.regles.agent.paliers_tro].sort((u, v) => u.seuil - v.seuil).find((u) => x.tro + 1e-9 < u.seuil);
            return pal ? { x, pal, manque: Math.ceil(pal.seuil * x.objMois - x.real - 1e-9) } : null; }).filter((v) => v && v.manque <= 5).sort((u, v) => u.manque - v.manque);
          zone.innerHTML = `<div class="stack">${CT.ui.enClair(`Sur la période, les ventes ${CT.esc(pr)} rapportent <b>${CT.fmt.fcfa(t.commissions)}</b> de commissions et <b>${CT.fmt.fcfa(t.primes)}</b> de primes. Il faut verser <b>${CT.fmt.fcfa(aVerser)}</b> aux vendeurs et superviseurs ; ${CT.esc(pr)} garde <b>${CT.fmt.fcfa(t.partenaire)}</b>.${t.projection != null ? ` Au rythme actuel, les commissions ${multi ? 'de la période (jusqu\'à la fin du mois en cours)' : 'du mois'} atteindront environ <b>${CT.fmt.fcfa(t.projection)}</b>.` : ''}`, 'fa-sack-dollar')}
            <div class="grid-tuiles">
              ${CT.ui.tuile({ icone: 'fa-hand-holding-dollar', ton: 'pos', titre: 'À verser aux équipes', valeur: CT.fmt.fcfa(aVerser), aide: 'Commissions vendeurs + toutes les primes' })}
              ${CT.ui.tuile({ icone: 'fa-building-columns', ton: 'info', titre: 'Part ' + CT.esc(pr), valeur: CT.fmt.fcfa(t.partenaire), aide: '20 % des commissions des équipes · rien sur Anonymat (100 % aux vendeurs)' })}
              ${CT.ui.tuile({ icone: 'fa-medal', ton: 'warn', titre: 'Primes de performance', valeur: CT.fmt.fcfa(t.primes), aide: CT.fmt.int(cp.vendeurs.filter((v) => v.primes > 0).length) + ' vendeur(s) primé(s)' })}
              ${CT.ui.tuile({ icone: 'fa-chart-line', titre: 'Projection fin de mois', valeur: t.projection == null ? '—' : CT.fmt.fcfa(t.projection), p: t.projection != null && pot.commissions ? t.projection / pot.commissions : null, aide: 'Commissions si le rythme continue' })}
              ${CT.ui.tuile({ icone: 'fa-bullseye', titre: 'Si 100 % de l\'objectif', valeur: CT.fmt.fcfa(pot.commissions), p: pot.commissions ? t.commissions / pot.commissions : null, aide: CT.fmt.pct(pot.commissions ? t.commissions / pot.commissions : 0, 0) + ' déjà gagnés · dont ' + CT.fmt.fcfa(pot.partenaire) + ' ' + CT.esc(pr) })}
              ${CT.ui.tuile({ icone: 'fa-scale-balanced', ton: b.ratio != null && b.ratio < 0.5 ? 'pos' : 'warn', titre: 'Coût du plan / marge', valeur: b.ratio == null ? '—' : CT.fmt.pct(b.ratio, 0), aide: 'Primes ' + CT.fmt.fcfa(b.cout) + ' pour ' + CT.fmt.fcfa(b.marge) + ' de marge' })}
            </div>
            ${CT.ui.grillePrimes(cp, pr)}
            <div class="grid-2">
              <section class="card"><div class="card-head"><div><h3><i class="fa-solid fa-ranking-star" aria-hidden="true"></i> Ceux qui gagnent le plus</h3><p>Commission + primes de la période</p></div></div>
                ${CT.ui.podium(cp.vendeurs.map((v) => ({ nom: CT.loginCourt(v.login), sous: v.equipe + ' · ' + CT.fmt.int(v.b2c + v.b2b) + ' ventes', valeur: CT.valeurKpi(CT.fmt.fcfa(v.gain)) })))}</section>
              <section class="card"><div class="card-head"><div><h3><i class="fa-solid fa-stairs" aria-hidden="true"></i> Tout près du palier suivant</h3><p>Vendeurs à 5 ventes ou moins d'une prime de fin de mois</p></div></div>
                ${proches.length ? `<ul class="proches">${proches.slice(0, 8).map((v) => `<li><b>${CT.esc(CT.loginCourt(v.x.login))}</b> <small class="muted">${CT.esc(v.x.equipe)} · TRO ${CT.fmt.pct(v.x.tro, 0)}</small><span>encore <b class="num">${v.manque}</b> vente${v.manque > 1 ? 's' : ''} → ${CT.esc(v.pal.nom)} (${CT.fmt.fcfa(v.pal.prime)})</span></li>`).join('')}</ul>` : '<p class="muted">Personne à moins de 5 ventes d\'un palier.</p>'}</section>
            </div>
            <section class="card"><div class="card-head"><div><h3>Par équipe</h3><p>Commissions et primes de chaque équipe, ventes B2C et B2B séparées</p></div></div><div id="pf-primes-eq"></div></section>
            <section class="card" id="pf-login-card"><div class="card-head"><div><h3>Par vendeur — One-Shot &amp; commissions</h3><p>${CT.esc(pr)} · B2B × ${mn(m.comm.b2b)} + B2C × ${mn(m.comm.b2c)} FCFA · part commercial / part ${CT.esc(pr)} selon l'équipe (0 % pour ANONYMAT)</p></div>
              <div class="field" style="min-width:170px"><label for="pf-eq-filter">Équipe</label><select class="select input-sm" id="pf-eq-filter"><option value="">Toutes les équipes</option>${e.perfLogin.equipes.map((q) => `<option value="${CT.esc(q.id)}">${CT.esc(q.id)}</option>`).join('')}</select></div></div>
              <div id="pf-login"></div><p class="mini-cap">Réalisation = ventes (B2B + B2C) ÷ ${partielle ? 'objectif du mois au prorata des ' + m.ouvresEcoules + ' jour(s) ouvré(s) de la période' : 'objectif du mois'}. Les montants sont en FCFA.</p></section>
            <section class="card"><div class="card-head"><div><h3>Qui touche combien</h3><p>Chaque vendeur : sa commission, ses primes et le total à lui verser</p></div></div><div id="pf-gains"></div></section>
            <section class="card"><div class="card-head"><div><h3>Barème : comment on gagne</h3><p>Règles du plan de motivation de ${CT.esc(CT.date.libelleMois(e.cle))} (modifiables dans Paramètres)</p></div></div>${CT.ui.bareme(m.regles, m.comm)}</section>
            <section class="card"><div class="card-head"><div><h3>Budget du plan</h3><p>Coût des primes face à la marge ${CT.esc(pr)}</p></div></div><div id="pf-budget"></div></section></div>`;
          zone.querySelector('#pf-primes-eq').append(CT.ui.tablePrimesEquipes(cp, pr).el);
          zone.querySelector('#pf-gains').append(CT.ui.tableGains(cp, pr).el);
          zone.querySelector('#pf-eq-filter').addEventListener('change', () => rendreLogin(e));
          rendreLogin(e);
          zone.querySelector('#pf-budget').append(CT.table.creer({ pageSize: 0, caption: 'Budget du plan', triInit: null,
            lignes: [['Primes journées agents', b.coutAg.journees], ['Primes champion du jour', b.coutAg.champion], ['Paliers agents (à date)', b.coutAg.paliers], ['Bonus B2B', b.coutAg.bonusB2B], ['Primes journées superviseurs', b.coutSup.journees],
              ['Paliers superviseurs', b.coutSup.finMois], ['Trophée équipe', b.coutSup.trophee]].map((x) => ({ poste: x[0], montant: x[1] })),
            colonnes: [{ cle: 'poste', titre: 'Poste' }, { cle: 'montant', titre: 'Montant (FCFA)', num: true, fmt: CT.fmt.mnt }],
            pied: { poste: 'Coût total du plan', montant: b.cout } }).el);
        },
        objectifs(zone) {
          const atteintes = m.equipes.filter((x) => x.tro >= 1).length;
          zone.innerHTML = `<div class="stack">${CT.ui.enClair(`<b>${atteintes}</b> équipe(s) sur ${m.equipes.length} ont déjà atteint leur objectif. Le <b>TRO</b> est le % de l'objectif réalisé ; le <b>rythme</b> compare aux ventes attendues à ce jour (100 % = dans les temps).`, 'fa-bullseye')}
            <div class="cartes-equipes">${[...m.equipes].sort((a, c) => c.tro - a.tro).map((q) => `<div class="carte-eq ${q.tro >= 1 ? 'ok' : ''}"><div class="carte-eq-tete"><b>${CT.esc(q.id)}</b>${CT.ui.pastille(q.tro >= 1)}</div>
              <div class="carte-eq-val num">${CT.fmt.pct(q.tro, 0)} <small>${mn(q.real)} / ${mn(q.objMois)}</small></div>${CT.ui.jauge(q.tro, q.id)}<small class="muted">Rythme ${CT.fmt.pct(q.rythme, 0)} · ${CT.esc(q.palier)}</small></div>`).join('')}</div>
            <section class="card"><div class="card-head"><div><h3>Suivi des équipes</h3><p>TRO, activation, paliers superviseurs et marge ${CT.esc(pr)}</p></div></div><div id="pf-eq"></div></section>
            <section class="card"><div class="card-head"><div><h3>Classement des vendeurs</h3><p>Top 10 par TRO</p></div></div><div id="pf-top"></div></section></div>`;
          zone.querySelector('#pf-eq').append(CT.table.creer({ pageSize: 0, caption: 'Suivi des équipes', lignes: m.equipes, triInit: { cle: 'rang', dir: 'asc' },
            colonnes: [{ cle: 'rang', titre: 'Rang', num: true }, { cle: 'id', titre: 'Équipe' }, { cle: 'objMois', titre: 'Obj. mois', num: true, fmt: CT.fmt.int }, { cle: 'real', titre: 'Réalisé', num: true }, { cle: 'tro', titre: 'TRO', num: true, fmt: (v) => CT.fmt.pct(v, 0) },
              { cle: 'rythme', titre: 'Rythme', num: true, fmt: (v) => CT.fmt.pct(v, 0) }, { cle: 'agentsActifs', titre: 'Agents actifs (≥80 %)', num: true, fmt: (v, x) => v + ' / ' + x.agentsAvecObjectif }, { cle: 'tauxActivation', titre: 'Activation', num: true, fmt: (v) => CT.fmt.pct(v, 0) },
              { cle: 'journeesReussies', titre: 'Journées réussies', num: true }, { cle: 'palier', titre: 'Palier superviseur', html: true, fmt: (v) => `<span class="badge ${v === 'Aucun' ? '' : v.startsWith('Bloqué') ? 'badge-warn' : 'badge-pos'}">${CT.esc(v)}</span>` },
              { cle: 'primeFinMois', titre: 'Prime fin de mois (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'primesJournees', titre: 'Primes journées (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'trophee', titre: 'Trophée (FCFA)', num: true, fmt: CT.fmt.mnt },
              { cle: 'totalSup', titre: 'Total superviseur (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'marge', titre: 'Marge ' + pr + ' (FCFA)', num: true, fmt: CT.fmt.mnt }] }).el);
          zone.querySelector('#pf-top').append(CT.table.creer({ pageSize: 0, caption: 'Top 10 agents', lignes: m.classement,
            colonnes: [{ cle: 'rang', titre: '#', num: true }, { cle: 'login', titre: 'Login', fmt: (v) => CT.loginCourt(v) }, { cle: 'equipe', titre: 'Équipe' }, { cle: 'real', titre: 'Réalisé', num: true }, { cle: 'tro', titre: 'TRO', num: true, fmt: (v) => CT.fmt.pct(v, 0) }, { cle: 'palier', titre: 'Palier' }] }).el);
        },
        autres(zone) {
          let choix = (() => { try { return sessionStorage.getItem('ct_partenaire_vu'); } catch (_) { return null; } })();
          if (!autres.some((r) => r.partenaire === choix)) choix = autres.length ? autres[0].partenaire : '';
          zone.innerHTML = `<div class="stack">${CT.ui.enClair(`Choisissez un partenaire pour voir <b>ses</b> performances, séparément de ${CT.esc(pr)}. Le comparatif de tous les partenaires est en bas de page.`, 'fa-handshake')}
            <div class="field choix-partenaire"><label for="pf-partenaire">Partenaire</label><select class="select" id="pf-partenaire">${autres.map((r) => `<option value="${CT.esc(r.partenaire)}"${r.partenaire === choix ? ' selected' : ''}>${CT.esc(r.partenaire)} — ${mn(r.ventes)} ventes</option>`).join('')}</select></div>
            <div id="pf-partenaire-vue" class="stack"></div>
            <details class="card comparatif"><summary><i class="fa-solid fa-table-list" aria-hidden="true"></i> Comparatif de tous les partenaires (classement, part de marché, historique, meilleurs vendeurs)</summary><div class="stack" id="pf-comparatif"></div></details></div>`;
          const sel = zone.querySelector('#pf-partenaire'), vue = zone.querySelector('#pf-partenaire-vue');
          const montrer = () => { try { sessionStorage.setItem('ct_partenaire_vu', sel.value); } catch (_) { /* stockage indisponible */ } rendrePartenaire(vue, ctx, sel.value); };
          sel.addEventListener('change', montrer);
          if (choix) montrer(); else vue.innerHTML = '<p class="muted">Aucun autre partenaire sur la période.</p>';
          const det = zone.querySelector('details.comparatif');
          det.addEventListener('toggle', () => { if (det.open && !det.dataset.rendu) { det.dataset.rendu = '1'; rendreComparatif(zone.querySelector('#pf-comparatif'), ctx); } });
        },
      };
      const onglets = CT.ui.onglets({ cle: 'perf', rendu: (id, zone) => RUBRIQUES[id](zone), onglets: [
        { id: 'apercu', icone: 'fa-star', titre: CT.esc(pr) + ' en bref', aide: 'L\'essentiel' },
        { id: 'b2b', icone: 'fa-building', titre: 'Ventes B2B', aide: mn(rg.b2b) + ' entreprises' },
        { id: 'b2c', icone: 'fa-house-user', titre: 'Ventes B2C', aide: mn(rg.b2c) + ' particuliers' },
        { id: 'commissions', icone: 'fa-sack-dollar', titre: 'Commissions & primes', aide: 'Qui gagne combien' },
        { id: 'objectifs', icone: 'fa-bullseye', titre: 'Objectifs', aide: m.equipes.filter((x) => x.tro >= 1).length + ' / ' + m.equipes.length + ' équipes' },
        { id: 'autres', icone: 'fa-handshake', titre: 'Autres partenaires', aide: autres.length + ' partenaires' }] });
      root.replaceChildren(onglets);
      onglets.premier();
    },
    refreshTheme() { if (E().lignes.length) CT.perf.render(); },
    resume() {
      const e = E(), p = e.perf;
      const pr = e.prioritaire, rg = p.rows.find((r) => r.prioritaire) || { ventes: 0 };
      const top = p.rows.filter((r) => r.ventes > 0).slice(0, 5).map((r, i) => (i + 1) + '. ' + r.partenaire + ' ' + CT.fmt.int(r.ventes)).join(' | ');
      return ['Performance partenaires — ' + CT.date.libelleMois(e.cle) + ' (' + CT.periode.perf() + ')', '• Réseau : ' + CT.fmt.int(p.total.ventes) + ' ventes OK, projection ' + CT.fmt.int(p.total.projection),
        '• ' + pr + ' : rang ' + (rg.rang || '—') + ', ' + CT.fmt.int(rg.ventes) + ' ventes, part ' + CT.fmt.pct(rg.part || 0, 1) + ', ' + (CT.periode.perfPartielle() ? 'objectif de la période ' : 'objectif mois ') + CT.fmt.pct(e.motivPerf.reseau.tro, 1), '• Top 5 : ' + top].map(CT.fmt.txt).join('\n');
    },
    feuilles() {
      const e = E(), p = e.perf, m = e.motivPerf, b = e.budgetPeriode;
      /* Ligne TOTAL du suivi équipes : sommes + ratios GLOBAUX recalculés sur les totaux (pas une somme de pourcentages),
         avec les mêmes formules que calculs.js pour chaque équipe :
           TRO = réalisé ÷ objectif (objectif à date si la période ne part pas du 1er), Rythme = réalisé ÷ objectif à date,
           Activation = agents actifs ÷ agents avec objectif. */
      const totalEquipes = (mo) => {
        const q = mo.equipes, S = (f) => CT.somme(q, f), ratio = (a, d) => (d > 0 ? a / d : 0);
        const objMois = S((x) => x.objMois), real = S((x) => x.real), objADate = mo.multiMois ? S((x) => x.objADate) : S((x) => x.objJour) * mo.ouvresEcoules;
        const actifs = S((x) => x.agentsActifs), avecObj = S((x) => x.agentsAvecObjectif);
        return ['', 'TOTAL', objMois, real, ratio(real, mo.multiMois ? S((x) => x.objTro) : mo.partielle ? objADate : objMois), ratio(real, objADate), actifs + '/' + avecObj, ratio(actifs, avecObj),
          S((x) => x.journeesReussies), '', S((x) => x.primeFinMois), S((x) => x.primesJournees), S((x) => x.trophee), S((x) => x.totalSup), S((x) => x.marge)];
      };
      const num = (v) => (v == null ? '' : v);
      return [
        { nom: 'Classement partenaires', cols: [8, 18, 12, 8, 8, 12, 14, 14, 12, 14, 14, 12, 18],
          aoa: [['Rang', 'Partenaire', 'Ventes OK', 'B2C', 'B2B', 'En attente', 'CA (FCFA)', 'Part de marché', 'Mois préc.', 'Projection fin de mois', 'Écart vs préc.', 'Évolution', 'Commission estimée (FCFA)']]
            .concat(p.rows.map((r) => [r.rang, r.partenaire, r.ventes, r.b2c, r.b2b, r.attente, r.ca, r.part, r.precedent, Math.round(r.projection), Math.round(r.ecartPrec), r.nouveau ? 'Nouveau' : (r.evolution == null ? 0 : r.evolution), r.commission]))
            .concat([['', 'TOTAL', p.total.ventes, p.total.b2c, p.total.b2b, p.total.attente, p.total.ca, 1, p.total.precedent, Math.round(p.total.projection), Math.round(p.total.ecartPrec), p.total.evolution == null ? 0 : p.total.evolution, p.total.commission]]) },
        { nom: 'Historique', cols: [18].concat(p.labelsHisto.map(() => 9), [14, 12]),
          aoa: [['Partenaire'].concat(p.labelsHisto, ['Mois en cours (cumul)', 'Projection'])].concat(p.rows.map((r) => [r.partenaire].concat(p.labelsHisto.map((_, i) => num(r.histo[i])), [r.ventes, r.projection == null ? '' : Math.round(r.projection)])))
            // Total de CHAQUE mois (réalisé global du réseau), du cumul en cours et de la projection
            .concat([['TOTAL'].concat(p.labelsHisto.map((_, i) => CT.somme(p.rows, (r) => +r.histo[i] || 0)), [CT.somme(p.rows, (r) => r.ventes), CT.somme(p.rows, (r) => (r.projection == null ? 0 : Math.round(r.projection)))])]) },
        { nom: 'Performance login', cols: [12, 30, 11, 11, 10, 12, 10, 12, 18, 18, 18, 18, 16, 12, 16],
          aoa: [['Équipe', 'Login', 'B2B vendus', 'B2C vendus', 'Obj. mois', 'Obj. semaine', 'Obj. jour', 'Réalisation', 'One-Shot B2B (FCFA)', 'One-Shot B2C (FCFA)', 'Total One-Shot (FCFA)', 'Part commercial (FCFA)', 'Part ' + e.prioritaire + ' (FCFA)', 'Palier', 'Primes plan (FCFA)']]
            .concat(e.perfLogin.rows.map((r) => [r.equipe, r.login, r.b2b, r.b2c, r.objMois, r.objSemaine, r.objJour, r.taux == null ? '' : r.taux, r.oneShotB2B, r.oneShotB2C, r.oneShot, r.partCommercial, r.partRgz, r.palier, r.primesPlan]))
            .concat([['TOTAL', '', e.perfLogin.total.b2b, e.perfLogin.total.b2c, e.perfLogin.total.objMois, e.perfLogin.total.objSemaine, e.perfLogin.total.objJour, e.perfLogin.total.taux == null ? '' : e.perfLogin.total.taux, e.perfLogin.total.oneShotB2B, e.perfLogin.total.oneShotB2C, e.perfLogin.total.oneShot, e.perfLogin.total.partCommercial, e.perfLogin.total.partRgz, '', e.perfLogin.total.primesPlan]]) },
        { nom: 'Réalisation équipes', cols: [14, 10, 10, 10, 10, 12, 10, 14, 18, 18, 18],
          aoa: [['Équipe', 'B2B vendus', 'B2C vendus', 'Ventes', 'Obj. mois', 'Obj. semaine', 'Obj. jour', 'Taux de réalisation', 'Total One-Shot (FCFA)', 'Part commercial (FCFA)', 'Part ' + e.prioritaire + ' (FCFA)']]
            .concat(e.perfLogin.equipes.map((q) => [q.id, q.b2b, q.b2c, q.total, q.objMois, q.objSemaine, q.objJour, q.taux == null ? '' : q.taux, q.oneShot, q.partCommercial, q.partRgz]))
            .concat([['TOTAL', e.perfLogin.total.b2b, e.perfLogin.total.b2c, e.perfLogin.total.total, e.perfLogin.total.objMois, e.perfLogin.total.objSemaine, e.perfLogin.total.objJour, e.perfLogin.total.taux == null ? '' : e.perfLogin.total.taux, e.perfLogin.total.oneShot, e.perfLogin.total.partCommercial, e.perfLogin.total.partRgz]]) },
        { nom: 'Suivi équipes', cols: [8, 12, 10, 10, 8, 8, 12, 12, 14, 20, 14, 14, 12, 14, 14],
          aoa: [['Rang', 'Équipe', 'Obj. mois', 'Réalisé', 'TRO', 'Rythme', 'Agents actifs', 'Activation', 'Journées réussies', 'Palier superviseur', 'Prime fin de mois', 'Primes journées', 'Trophée', 'Total superviseur', 'Marge ' + e.prioritaire]]
            .concat(m.equipes.map((x) => [x.rang, x.id, x.objMois, x.real, x.tro, x.rythme, x.agentsActifs + '/' + x.agentsAvecObjectif, x.tauxActivation, x.journeesReussies, x.palier, x.primeFinMois, x.primesJournees, x.trophee, x.totalSup, x.marge]))
            .concat([totalEquipes(m)]) },
        CT.ui.feuillePrimes(e.primesPeriode, 'Commissions et primes', e.prioritaire),
        { nom: 'Budget', cols: [34, 16], aoa: [['Poste', 'Montant (FCFA)'], ['Primes journées agents', b.coutAg.journees], ['Primes champion', b.coutAg.champion], ['Paliers agents', b.coutAg.paliers], ['Bonus B2B', b.coutAg.bonusB2B],
          ['Primes journées superviseurs', b.coutSup.journees], ['Paliers superviseurs', b.coutSup.finMois], ['Trophée', b.coutSup.trophee], ['COÛT TOTAL', b.cout], ['Marge ' + e.prioritaire, b.marge], ['Ratio coût / marge', b.ratio == null ? '' : b.ratio]] },
      ];
    },
  };
})();
