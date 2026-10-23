/* ============================================================================
   ui.js — briques visuelles partagées par le tableau de bord RGZ, le Point du jour
   et la Performance : sous-onglets, encadrés « En clair », grandes tuiles, jauges,
   grille des commissions & primes. Pensées pour être comprises d'un coup d'œil.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const lire = (cle) => { try { return sessionStorage.getItem('ct_onglet_' + cle); } catch (_) { return null; } };
  const ecrire = (cle, v) => { try { sessionStorage.setItem('ct_onglet_' + cle, v); } catch (_) { /* stockage indisponible */ } };
  const tonDe = (p) => (p == null ? '' : p >= 1 ? 'pos' : p >= 0.6 ? 'info' : p >= 0.35 ? 'warn' : 'neg');

  CT.ui = {
    tonDe,
    /* Sous-onglets : une grosse étiquette par sujet (icône + titre + aide d'une ligne). L'onglet choisi est mémorisé
       pendant la session ; le contenu n'est construit qu'à l'ouverture de l'onglet (graphiques dans un conteneur visible). */
    onglets({ cle, onglets, rendu }) {
      let actif = lire(cle); if (!onglets.some((o) => o.id === actif)) actif = onglets[0].id;
      const barre = CT.h('div', { class: 'subtabs no-print', role: 'tablist', 'aria-label': 'Rubriques' });
      const zone = CT.h('div', { class: 'subtab-panel', role: 'tabpanel', tabindex: '-1' });
      const boutons = onglets.map((o) => {
        const b = CT.h('button', { type: 'button', role: 'tab', class: 'subtab', id: 'tab-' + cle + '-' + o.id, 'data-ton': o.ton || '' });
        b.innerHTML = `<span class="subtab-ic" aria-hidden="true"><i class="fa-solid ${o.icone}"></i></span><span class="subtab-txt"><b>${CT.esc(o.titre)}</b><small>${CT.esc(o.aide || '')}</small></span>`;
        b.addEventListener('click', () => ouvrir(o.id, true));
        b.addEventListener('keydown', (ev) => {
          const i = onglets.findIndex((x) => x.id === o.id), d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
          if (d) { ev.preventDefault(); const n = onglets[(i + d + onglets.length) % onglets.length]; ouvrir(n.id, true); document.getElementById('tab-' + cle + '-' + n.id).focus(); }
        });
        return b;
      });
      barre.append(...boutons);
      function ouvrir(id, parClic) {
        actif = id; ecrire(cle, id);
        onglets.forEach((o, i) => { const sel = o.id === id; boutons[i].setAttribute('aria-selected', String(sel)); boutons[i].tabIndex = sel ? 0 : -1; });
        zone.setAttribute('aria-labelledby', 'tab-' + cle + '-' + id);
        zone.replaceChildren();
        rendu(id, zone);
        if (parClic && barre.getBoundingClientRect().top < 0) barre.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const el = CT.h('div', { class: 'subtabs-wrap' }, barre, zone);
      el.ouvrir = ouvrir;
      el.premier = () => ouvrir(actif, false);
      return el;
    },
    /* Encadré « En clair » : une phrase simple qui dit ce que l'on regarde et quoi en retenir */
    enClair(texte, icone = 'fa-lightbulb') {
      return `<div class="en-clair"><span class="en-clair-ic" aria-hidden="true"><i class="fa-solid ${icone}"></i></span><p>${texte}</p></div>`;
    },
    /* Grande tuile : icône, libellé, gros chiffre, phrase d'aide et jauge facultative (p entre 0 et 1+) */
    tuile({ icone, ton = '', titre, valeur, aide = '', p = null }) {
      return `<div class="tuile ${ton}"><div class="tuile-head"><span class="tuile-ic" aria-hidden="true"><i class="fa-solid ${icone}"></i></span><span class="tuile-titre">${titre}</span></div>
        <div class="tuile-val num">${CT.valeurKpi(valeur)}</div>${p == null ? '' : CT.ui.jauge(p)}<div class="tuile-aide">${aide}</div></div>`;
    },
    jauge(p, label) {
      const v = Math.max(0, Math.min(1, p || 0));
      return `<div class="jauge ${tonDe(p)}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v * 100)}"${label ? ` aria-label="${CT.esc(label)}"` : ''}><span style="width:${v * 100}%"></span></div>`;
    },
    /* Pastille de réussite : ✔ objectif atteint / ✖ pas encore, avec un mot */
    pastille(ok, oui = 'Atteint', non = 'Pas encore') {
      return ok ? `<span class="pastille pos" title="${oui}"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span class="pastille-txt">${oui}</span></span>` : `<span class="pastille" title="${non}"><i class="fa-regular fa-circle" aria-hidden="true"></i><span class="pastille-txt">${non}</span></span>`;
    },
    /* Grille des commissions & primes (résultat de CT.calc.commissionsPrimes) : une carte par type de vente */
    grillePrimes(cp, pr) {
      const gagnante = ' <span class="badge badge-gagnant" title="Équipe n°1 : meilleur % de son objectif"><i class="fa-solid fa-trophy" aria-hidden="true"></i> Gagnante</span>';
      const ligne = (x) => `<li class="${x.type}${x.aDefinir ? ' a-definir' : ''}"><span class="gp-ic" aria-hidden="true"><i class="fa-solid ${x.type === 'commission' ? 'fa-coins' : 'fa-medal'}"></i></span>
        <div><b>${CT.esc(x.nom)}</b><small>${CT.esc(x.regle)}</small></div><span class="gp-mnt num">${x.aDefinir ? '—' : CT.valeurKpi(CT.fmt.fcfa(x.montant))}</span></li>`;
      return `<div class="grille-primes">${cp.groupes.map((g) => `<section class="gp-carte gp-${g.id}"><header><span class="gp-tete-ic" aria-hidden="true"><i class="fa-solid ${g.icone}"></i></span><div class="gp-tete-txt"><h4>${CT.esc(g.titre)}${g.id === 'anonymat' && g.equipes.includes(cp.gagnante) ? gagnante : ''}</h4><small>${g.id === 'anonymat' ? 'Toute la commission va aux vendeurs : ' + CT.esc(pr || 'le partenaire') + ' ne prend rien'
          : g.equipes.length ? g.equipes.length + ' équipe(s) : ' + g.equipes.map((id) => CT.esc(id) + (id === cp.gagnante ? gagnante : '')).join(', ') : 'Aucune équipe'}</small></div>
        <span class="gp-total num">${CT.valeurKpi(CT.fmt.fcfa(g.total))}</span></header><ul>${g.lignes.map(ligne).join('')}</ul></section>`).join('')}</div>
        <p class="legende-primes"><span><i class="fa-solid fa-coins" aria-hidden="true"></i> Commission : sur chaque vente</span><span><i class="fa-solid fa-medal" aria-hidden="true"></i> Prime : récompense d'un objectif atteint</span></p>`;
    },
    /* Podium : les 3 premiers (rang, nom, sous-titre, valeur) */
    podium(items) {
      const med = ['or', 'argent', 'bronze'];
      return items.length ? `<ol class="podium">${items.slice(0, 3).map((x, i) => `<li class="${med[i]}"><span class="podium-rang" aria-hidden="true">${i + 1}</span><div><b>${CT.esc(x.nom)}</b><small>${CT.esc(x.sous || '')}</small></div><span class="podium-val num">${x.valeur}</span></li>`).join('')}</ol>`
        : '<p class="muted">Personne pour le moment.</p>';
    },
    /* Barème du plan de motivation, lu dans les règles du mois : ce qu'il faut faire pour gagner quoi */
    bareme(R, comm) {
      const A = R.agent, S = R.superviseur, f = CT.fmt.fcfa, pc = (x) => CT.fmt.pct(x, 0);
      const ligne = (ic, quoi, combien) => `<li><span class="bar-ic" aria-hidden="true"><i class="fa-solid ${ic}"></i></span><span>${quoi}</span><b class="num">${combien}</b></li>`;
      return `<div class="bareme"><section><h4><i class="fa-solid fa-coins" aria-hidden="true"></i> Commissions (chaque vente)</h4><ul>
          ${ligne('fa-house-user', 'Vente B2C (particulier)', f(comm.b2c))}${ligne('fa-building', 'Vente B2B (entreprise)', f(comm.b2b))}
          ${ligne('fa-handshake', 'Partage : vendeurs / partenaire', '80 % / 20 %')}${ligne('fa-user-secret', 'Équipe Anonymat : vendeurs', '100 %')}</ul></section>
        <section><h4><i class="fa-solid fa-user-tie" aria-hidden="true"></i> Vendeur</h4><ul>
          ${ligne('fa-calendar-check', 'Chaque jour ouvré à l\'objectif', f(A.journee_reussie))}${ligne('fa-trophy', 'Champion du jour', f(A.champion_du_jour.prime))}
          ${[...A.paliers_tro].sort((a, b) => a.seuil - b.seuil).map((p) => ligne('fa-stairs', 'Fin de mois ≥ ' + pc(p.seuil) + ' (' + CT.esc(p.nom) + ')', f(p.prime))).join('')}
          ${ligne('fa-building', 'Objectif B2B du mois atteint', f(A.bonus_b2b))}</ul></section>
        <section><h4><i class="fa-solid fa-people-group" aria-hidden="true"></i> Superviseur / équipe</h4><ul>
          ${ligne('fa-calendar-check', 'Chaque jour où l\'équipe est à l\'objectif', f(S.journee_equipe))}
          ${[...S.paliers_tro].sort((a, b) => a.seuil - b.seuil).map((p) => ligne('fa-medal', 'Fin de mois ≥ ' + pc(p.seuil) + ' (' + CT.esc(p.nom) + ')', f(p.prime))).join('')}
          ${ligne('fa-lock-open', 'Condition : ≥ ' + pc(S.activation.taux_min) + ' des vendeurs à ' + pc(S.activation.seuil_agent), '')}
          ${ligne('fa-crown', 'Trophée : 1re équipe à ≥ ' + pc(S.trophee.tro_min), f(S.trophee.enveloppe))}</ul></section></div>`;
    },
    /* Qui touche combien : vendeurs classés par gain total (commission + primes) */
    tableGains(cp, pr) {
      return CT.table.creer({ pageSize: 15, recherche: true, caption: 'Gains par vendeur', lignes: cp.vendeurs, triInit: { cle: 'gain', dir: 'desc' }, classeLigne: (v) => (v.horsObjectif ? 'row-hors' : ''),
        colonnes: [{ cle: 'login', titre: 'Vendeur', fmt: (v) => CT.loginCourt(v) }, { cle: 'equipe', titre: 'Équipe' }, { cle: 'b2c', titre: 'B2C', num: true, fmt: CT.fmt.int }, { cle: 'b2b', titre: 'B2B', num: true, fmt: CT.fmt.int },
          { cle: 'commission', titre: 'Commission (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'primes', titre: 'Primes (FCFA)', num: true, fmt: CT.fmt.mnt },
          { cle: 'gain', titre: 'Total à verser (FCFA)', num: true, html: true, fmt: (v) => '<b>' + CT.fmt.mnt(v) + '</b>' }, { cle: 'palier', titre: 'Palier', html: true, fmt: (v) => (v && v !== 'Aucun' ? '<span class="badge badge-pos">' + CT.esc(v) + '</span>' : '<span class="muted">—</span>') }],
        pied: { login: 'TOTAL', equipe: CT.fmt.int(cp.vendeurs.length) + ' vendeurs', b2c: CT.somme(cp.vendeurs, (v) => v.b2c), b2b: CT.somme(cp.vendeurs, (v) => v.b2b), commission: CT.somme(cp.vendeurs, (v) => v.commission), primes: CT.somme(cp.vendeurs, (v) => v.primes), gain: CT.somme(cp.vendeurs, (v) => v.gain), palier: '' } });
    },
    /* Tableau « une ligne par équipe » des commissions et primes, par type de vente */
    tablePrimesEquipes(cp, pr) {
      const mn = CT.fmt.mnt, rows = cp.equipes.filter((q) => q.ventes > 0 || q.totalPrimes > 0);
      const t = (f) => CT.somme(rows, f);
      return CT.table.creer({ pageSize: 0, caption: 'Commissions et primes par équipe', lignes: rows, triInit: { cle: 'ventes', dir: 'desc' }, classeLigne: (q) => (q.anonymat ? 'row-hors' : ''),
        colonnes: [{ cle: 'id', titre: 'Équipe', html: true, fmt: (v, q) => CT.esc(v) + (q.anonymat ? ' <span class="badge">Anonymat</span>' : '') },
          { cle: 'b2c', titre: 'Ventes B2C', num: true, fmt: CT.fmt.int }, { cle: 'b2b', titre: 'Ventes B2B', num: true, fmt: CT.fmt.int },
          { cle: 'comB2CVendeurs', titre: 'Comm. B2C vendeurs', num: true, fmt: mn }, { cle: 'comB2CRgz', titre: 'Comm. B2C ' + pr, num: true, fmt: mn },
          { cle: 'comB2BVendeurs', titre: 'Comm. B2B vendeurs', num: true, fmt: mn }, { cle: 'comB2BRgz', titre: 'Comm. B2B ' + pr, num: true, fmt: mn },
          { cle: 'primeB2CVendeurs', titre: 'Prime B2C vendeurs', num: true, fmt: mn }, { cle: 'primeB2BVendeurs', titre: 'Prime B2B vendeurs', num: true, fmt: mn },
          { cle: 'primeEquipe', titre: 'Prime équipe (superviseur)', num: true, fmt: mn }, { cle: 'primeObjectif', titre: 'Prime atteinte objectif', num: true, fmt: mn },
          { cle: 'objectifAtteint', titre: 'Objectif', html: true, fmt: (v) => CT.ui.pastille(v) }],
        pied: { id: 'TOTAL', b2c: t((q) => q.b2c), b2b: t((q) => q.b2b), comB2CVendeurs: t((q) => q.comB2CVendeurs), comB2CRgz: t((q) => q.comB2CRgz), comB2BVendeurs: t((q) => q.comB2BVendeurs), comB2BRgz: t((q) => q.comB2BRgz),
          primeB2CVendeurs: t((q) => q.primeB2CVendeurs), primeB2BVendeurs: t((q) => q.primeB2BVendeurs), primeEquipe: t((q) => q.primeEquipe), primeObjectif: t((q) => q.primeObjectif), objectifAtteint: '' } });
    },
    /* Feuille Excel des commissions & primes (13 lignes + détail par équipe) */
    feuillePrimes(cp, nom, pr) {
      const aoa = [['Type de vente', 'Poste', 'Montant (FCFA)', 'Mode de calcul']];
      cp.groupes.forEach((g) => { g.lignes.forEach((x) => aoa.push([g.titre, x.nom, x.aDefinir ? '' : x.montant, x.regle])); aoa.push([g.titre, 'TOTAL ' + g.titre, g.total, '']); });
      aoa.push(['', 'TOTAL GÉNÉRAL', cp.total.general, '']);
      aoa.push([], ['Équipe', 'Ventes B2C', 'Ventes B2B', 'Comm. B2C vendeurs', 'Comm. B2C ' + pr, 'Comm. B2B vendeurs', 'Comm. B2B ' + pr, 'Prime B2C vendeurs', 'Prime B2B vendeurs', 'Prime équipe', 'Prime atteinte objectif']);
      cp.equipes.forEach((q) => aoa.push([q.id, q.b2c, q.b2b, q.comB2CVendeurs, q.comB2CRgz, q.comB2BVendeurs, q.comB2BRgz, q.primeB2CVendeurs, q.primeB2BVendeurs, q.primeEquipe, q.primeObjectif]));
      return { nom, filtre: false, cols: [24, 46, 16, 56, 14, 14, 16, 16, 16, 16, 16], aoa };
    },
  };
})();
