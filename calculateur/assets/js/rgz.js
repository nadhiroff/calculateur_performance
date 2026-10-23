/* ============================================================================
   rgz.js — « Tableau de bord RGZ » : uniquement le partenaire prioritaire (RGZ par défaut),
   sans aucun autre partenaire. Volumes sur la période choisie (dates de l'en-tête) ;
   objectifs, commissions et primes sur le mois de la date de fin (ils sont mensuels).
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const E = () => CT.etat;
  const charts = {};
  const jeton = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function chart(id, cfg) {
    const cv = document.getElementById(id); if (!cv || !window.Chart) return;
    if (charts[id]) charts[id].destroy();
    Chart.defaults.color = jeton('--text-2'); Chart.defaults.borderColor = jeton('--border');
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {});
    charts[id] = new Chart(cv, cfg);
  }

  /* Données de la page, calculées une fois par rendu (mêmes chiffres à l'écran et dans les exports).
     Tout suit la période [début → fin] des filtres : ventes, objectif de la période, équipes, commissions et primes
     (calcul commun app.js : mêmes montants que le Point du jour et la Performance). Seul « Aujourd'hui » reste la date de fin.
     Objectifs, commissions et primes sont mensuels : sur une période à cheval sur deux mois, ils portent sur la partie
     du mois de la date de fin (dP), les ventes sur toute la période. */
  function donnees() {
    const e = E(), pr = e.prioritaire, p = CT.dashboard.periodeDash(), debutMois = e.cle + '-01', dP = CT.periode.perfDu();
    const idx = CT.objectifs.indexLogins(e.motiv.objectifs);
    const R = e.motiv.regles, compte = (l) => (R.statuts_comptes || ['OK']).includes(l.statut);
    const L = e.lignes.filter((l) => l.partenaire === pr && l.jour && l.jour >= p.du && l.jour <= p.au);
    const ok = L.filter(compte);
    const k = CT.calc.kpis(L, { seuil: R.seuil_montant_atypique || 1e6 });
    const b2c = ok.filter((l) => l.segment !== 'B2B').length, b2b = ok.length - b2c;
    const cp = e.primesPeriode, mp = e.motivPerf, obj = CT.periode.objectif(), sem = CT.periode.semaine();
    // Équipes face à l'objectif de la période : réalisé depuis le début de la période / objectif du jour × jours ouvrés écoulés
    const equipes = mp.equipes.map((q) => { const o = Math.round(q.objADate != null ? q.objADate : q.objJour * mp.ouvresEcoules); return { id: q.id, real: q.real, obj: o, taux: o > 0 ? q.real / o : 0, objMois: q.objMois, realMois: (e.motiv.equipes.find((x) => x.id === q.id) || {}).real || 0 }; });
    const equipeDe = (l) => (idx.get(l.loginKey) || {}).equipe || 'À préciser';
    return { e, pr, p, L, ok, k, b2c, b2b, cp, m: e.motiv, mp, obj, sem, equipes, equipeDe, debutMois, dP, coupe: p.du < dP };
  }

  CT.rgz = {
    render() {
      const root = document.getElementById('rgz-content'); if (!root) return;
      const e = E();
      if (!e.lignes.length) { root.innerHTML = ''; return; }
      const d = donnees(), { pr, p, ok, k, b2c, b2b, cp, m, obj, sem } = d, r = m.reseau, mn = CT.fmt.int;
      const ecart = obj.real - obj.objectif;
      const periode = 'du ' + CT.date.court(p.du) + ' au ' + CT.date.court(p.au), perObj = 'du ' + CT.date.court(d.dP) + ' au ' + CT.date.court(e.jourRef);
      document.getElementById('h-rgz').textContent = 'Tableau de bord ' + pr;
      document.getElementById('rgz-sub').textContent = 'Uniquement ' + pr + ' · période ' + periode + (d.coupe ? ' · objectifs, commissions et primes ' + perObj + ' (mensuels)' : '');

      root.innerHTML = `
      <div class="stack">
        <section class="rgz-hero">
          <div class="rgz-hero-txt"><span class="eyebrow">Partenaire ${CT.esc(pr)}</span>
            <h2>${mn(ok.length)} ventes validées</h2>
            <p>${periode} · ${mn(b2c)} particuliers (B2C) · ${mn(b2b)} entreprises (B2B)</p></div>
          <div class="rgz-hero-obj"><span>Objectif de la période</span><b class="num">${obj.taux == null ? '—' : CT.fmt.pct(obj.taux, 0)}</b>${CT.ui.jauge(obj.taux || 0, 'Objectif de la période')}<small>${mn(obj.real)} / ${mn(obj.objectif)} ventes · ${perObj}</small></div>
        </section>
        ${obj.objectif <= 0 ? CT.ui.enClair(`${CT.esc(pr)} a fait <b>${mn(obj.real)}</b> vente(s) ${perObj}. L'avance ou le retard ne peut pas être calculé : aucun jour ouvré sur la période ou objectifs du jour non renseignés (Paramètres › Objectifs).`, 'fa-circle-info') : CT.ui.enClair(ecart >= 0
          ? `<b>Bonne nouvelle :</b> ${CT.esc(pr)} est <b>en avance de ${mn(ecart)} vente(s)</b> sur l'objectif de la période (${mn(obj.objectif)} attendues ${perObj}).`
          : `<b>Attention :</b> ${CT.esc(pr)} a <b>${mn(-ecart)} vente(s) de retard</b> sur l'objectif de la période (${mn(obj.objectif)} attendues ${perObj}, ${mn(obj.real)} faites).`, ecart >= 0 ? 'fa-face-smile' : 'fa-triangle-exclamation')}
        <div class="grid-tuiles">
          ${CT.ui.tuile({ icone: 'fa-calendar-day', ton: CT.ui.tonDe(r.objJour ? r.ventesJour / r.objJour : null), titre: 'Aujourd\'hui (' + CT.date.court(e.jourRef) + ')', valeur: r.objJour ? mn(r.ventesJour) + ' / ' + mn(r.objJour) : mn(r.ventesJour), p: r.objJour ? r.ventesJour / r.objJour : null, aide: r.objJour ? 'Ventes du jour / objectif du jour' : 'Ventes du jour · objectif du jour non renseigné' })}
          ${CT.ui.tuile({ icone: 'fa-calendar-week', ton: CT.ui.tonDe(sem.objectif ? sem.ventes / sem.objectif : null), titre: 'Semaine', valeur: sem.objectif ? mn(sem.ventes) + ' / ' + mn(sem.objectif) : mn(sem.ventes), p: sem.objectif ? sem.ventes / sem.objectif : null, aide: 'Du ' + CT.date.court(sem.du) + ' au ' + CT.date.court(e.jourRef) + (sem.objectif ? '' : ' · objectif non renseigné') })}
          ${CT.ui.tuile({ icone: 'fa-calendar', ton: CT.ui.tonDe(obj.taux), titre: 'Objectif de la période', valeur: mn(obj.real) + ' / ' + mn(obj.objectif), p: obj.taux, aide: 'Mois de ' + CT.date.libelleMois(e.cle).toLowerCase() + ' : ' + mn(r.real) + ' / ' + mn(r.objMois) + ' au ' + CT.date.court(e.jourRef) })}
          ${CT.ui.tuile({ icone: 'fa-coins', ton: 'pos', titre: 'Commissions de la période', valeur: CT.fmt.fcfa(cp.total.commissions), aide: 'Dont ' + CT.fmt.fcfa(cp.total.partenaire) + ' pour ' + CT.esc(pr) })}
          ${CT.ui.tuile({ icone: 'fa-medal', ton: 'warn', titre: 'Primes de la période', valeur: CT.fmt.fcfa(cp.total.primes), aide: cp.mode === 'periode' ? 'Gagnées jour par jour (journées réussies, champion)' : 'Journées, champion, paliers et bonus à date' })}
          ${CT.ui.tuile({ icone: 'fa-hourglass-half', ton: k.valide ? 'warn' : '', titre: 'En attente', valeur: mn(k.valide), aide: 'Ventes pas encore validées (statut VALIDE)' })}
        </div>
        <div class="grid-2">
          <section class="card"><div class="card-head"><div><h3>Ventes ${CT.esc(pr)} par jour</h3><p>Ventes validées ${periode}</p></div></div><div class="chart-box"><canvas id="rgz-ch-jour" role="img" aria-label="Ventes ${CT.esc(pr)} par jour"></canvas></div></section>
          <section class="card"><div class="card-head"><div><h3>Particuliers ou entreprises ?</h3><p>Répartition des ventes validées</p></div></div><div class="chart-box"><canvas id="rgz-ch-seg" role="img" aria-label="Répartition B2C / B2B"></canvas></div></section>
        </div>
        <div class="grid-2">
          <section class="card"><div class="card-head"><div><h3>Les équipes face à leur objectif</h3><p>${perObj} · la barre montre le % de l'objectif de la période</p></div></div><ol class="rank" id="rgz-equipes"></ol></section>
          <section class="card"><div class="card-head"><div><h3>Meilleurs vendeurs ${CT.esc(pr)}</h3><p>Ventes validées ${periode}</p></div></div><ol class="rank" id="rgz-vendeurs"></ol></section>
        </div>
        <section class="card"><div class="card-head"><div><h3>À surveiller</h3><p>Alertes calculées automatiquement pour ${CT.esc(pr)}</p></div></div><ul class="alerts" id="rgz-alertes"></ul></section>
      </div>`;

      // Équipes : barre = % de l'objectif de la période
      const eqs = [...d.equipes].sort((a, b) => b.taux - a.taux || b.real - a.real);
      document.getElementById('rgz-equipes').innerHTML = eqs.map((q, i) => `<li><span class="pos-n">${i + 1}</span><div><div class="nm">${CT.esc(q.id)} ${q.obj > 0 && q.taux >= 1 ? '<i class="fa-solid fa-circle-check txt-pos" title="Objectif de la période atteint"></i>' : ''}</div>${CT.ui.jauge(q.taux, q.id)}</div>
        <div class="text-right"><b class="num">${q.obj > 0 ? CT.fmt.pct(q.taux, 0) : '—'}</b><small class="muted">${mn(q.real)} / ${mn(q.obj)}</small></div></li>`).join('') || '<p class="muted">Aucune équipe dans les objectifs.</p>';
      // Vendeurs : top 10 de la période
      const top = CT.calc.grouper(ok, (l) => l.loginKey).slice(0, 10), max = top.length ? top[0].n : 1;
      document.getElementById('rgz-vendeurs').innerHTML = top.map((g, i) => {
        const l = ok.find((x) => x.loginKey === g.cle), eq = d.equipeDe(l);
        return `<li><span class="pos-n">${i + 1}</span><div><div class="nm">${CT.esc(CT.loginCourt(g.cle))} <small class="muted">· ${CT.esc(eq)}</small></div><div class="bar" aria-hidden="true"><span style="width:${(g.n / max) * 100}%"></span></div></div><div class="text-right"><b class="num">${mn(g.n)}</b><small class="muted">ventes</small></div></li>`;
      }).join('') || '<p class="muted">Aucune vente validée sur la période.</p>';
      // Alertes : périmètre RGZ de la période
      const ic = { neg: 'critique', warn: 'alerte', info: 'info', pos: 'succes' };
      const lignesP = e.lignes.filter((l) => l.partenaire === pr && l.jour && l.jour >= d.dP && l.jour <= e.jourRef);
      document.getElementById('rgz-alertes').innerHTML = CT.calc.alertes(lignesP, d.mp).map((a) => `<li class="alert ${a.niveau}"><span class="alert-ic">${CT.icone(ic[a.niveau])}</span><div><strong>${CT.esc(a.titre)}</strong><span>${CT.esc(a.detail)}</span></div></li>`).join('');

      // Graphiques
      const jours = new Map();
      ok.forEach((l) => { const g = jours.get(l.jour) || { b2c: 0, b2b: 0 }; if (l.segment === 'B2B') g.b2b++; else g.b2c++; jours.set(l.jour, g); });
      const cles = [...jours.keys()].sort(), c1 = jeton('--series-1'), c2 = jeton('--accent-rgz'), surface = jeton('--surface');
      const barres = { borderRadius: 3, borderSkipped: false, maxBarThickness: 26, borderColor: surface, borderWidth: { top: 1 } };
      chart('rgz-ch-jour', { type: 'bar', data: { labels: cles.map((j) => CT.date.court(j).slice(0, 5)), datasets: [
        Object.assign({ label: 'B2C (particuliers)', data: cles.map((j) => jours.get(j).b2c), backgroundColor: c1 }, barres),
        Object.assign({ label: 'B2B (entreprises)', data: cles.map((j) => jours.get(j).b2b), backgroundColor: c2 }, barres)] },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } } });
      chart('rgz-ch-seg', { type: 'doughnut', data: { labels: ['B2C (particuliers)', 'B2B (entreprises)'], datasets: [{ data: [b2c, b2b], backgroundColor: [c1, c2], borderColor: surface, borderWidth: 2 }] },
        options: { cutout: '62%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ' ' + c.label + ' : ' + mn(c.parsed) + ' (' + CT.fmt.pct(ok.length ? c.parsed / ok.length : 0, 0) + ')' } } } } });
    },
    refreshTheme() { if (E().lignes.length) CT.rgz.render(); },
    resume() {
      const d = donnees();
      return ['Tableau de bord ' + d.pr + ' — du ' + CT.date.court(d.p.du) + ' au ' + CT.date.court(d.p.au),
        '• Ventes validées : ' + CT.fmt.int(d.ok.length) + ' (' + CT.fmt.int(d.b2c) + ' B2C, ' + CT.fmt.int(d.b2b) + ' B2B)',
        '• Objectif de la période : ' + CT.fmt.int(d.obj.real) + ' / ' + CT.fmt.int(d.obj.objectif) + (d.obj.taux == null ? '' : ' (' + CT.fmt.pct(d.obj.taux) + ')'),
        '• Commissions de la période : ' + CT.fmt.fcfa(d.cp.total.commissions) + ' · primes : ' + CT.fmt.fcfa(d.cp.total.primes)].map(CT.fmt.txt).join('\n');
    },
    feuilles() {
      const d = donnees(), r = d.m.reseau;
      return [
        { nom: 'Synthèse ' + d.pr, cols: [36, 18], aoa: [['Indicateur', 'Valeur'], ['Période des ventes', CT.date.court(d.p.du) + ' → ' + CT.date.court(d.p.au)], ['Ventes validées', d.ok.length], ['Ventes B2C', d.b2c], ['Ventes B2B', d.b2b], ['En attente (VALIDE)', d.k.valide],
          ['Objectif de la période', d.obj.objectif], ['Réalisé de la période', d.obj.real], ['% objectif de la période', d.obj.taux == null ? '' : d.obj.taux],
          ['Objectif du mois', r.objMois], ['Réalisé du mois (au ' + CT.date.court(d.e.jourRef) + ')', r.real],
          ['Commissions de la période (FCFA)', d.cp.total.commissions], ['Primes de la période (FCFA)', d.cp.total.primes]] },
        { nom: 'Équipes ' + d.pr, cols: [16, 14, 12, 14, 14, 12], aoa: [['Équipe', 'Objectif période', 'Réalisé période', '% objectif période', 'Objectif mois', 'Réalisé mois']].concat(d.equipes.map((q) => [q.id, q.obj, q.real, q.taux, q.objMois, q.realMois])) },
        CT.ui.feuillePrimes(d.cp, 'Commissions et primes', d.pr),
      ];
    },
  };
})();
