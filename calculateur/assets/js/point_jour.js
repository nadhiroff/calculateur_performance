/* ============================================================================
   point_jour.js — rapport « Point du jour » (format du modèle Point_du_jour_12_octobre_2026.xlsx) :
   Équipes, Agents, Points d'attention, Message WhatsApp, Paramètres.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const E = () => CT.etat;
  let graphe = null;   // graphique du Résumé (détruit avant chaque nouveau rendu)
  const oui = (b) => (b ? '<span class="badge badge-pos">Oui</span>' : '<span class="badge">Non</span>');
  const kpi = (ic, c, l, v, s) => `<div class="kpi"><div class="kpi-icon ${c}" aria-hidden="true"><i class="fa-solid ${ic}"></i></div><div><div class="kpi-label">${l}</div><div class="kpi-value num">${CT.valeurKpi(v)}</div><div class="kpi-sub">${s}</div></div></div>`;

  /* ---------- Image du tableau des vendeurs (à coller dans WhatsApp) ----------
     Format attendu par la direction (modèle Excel) : Équipe, login, objectif, ventes, PERF — seulement les vendeurs
     à 100 % ou plus de leur objectif sur la période filtrée, en gros caractères. Au-delà de 15 lignes : plusieurs images.
     Les exports Excel ne sont pas concernés (ils gardent toutes les colonnes).
     (Un lien WhatsApp ne peut transporter que du texte : l'image passe donc par le presse-papier.) */
  const MOIS_CAP = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  const jourMois = (j) => j.slice(8, 10) + '-' + MOIS_CAP[+j.slice(5, 7) - 1];   // 2026-10-14 → 14-oct
  const LIGNES_PAR_IMAGE = 15;

  function enTetesCapture(m) {
    const du = m.estPlage && m.jourDu ? m.jourDu : null, au = m.jourRef;
    if (!du) return { obj: 'OBJECTIF/JOURS', ventes: jourMois(au), perf: 'PERF-' + au.slice(8, 10) };
    return { obj: 'OBJECTIF/PÉRIODE', ventes: (du.slice(0, 7) === au.slice(0, 7) ? du.slice(8, 10) : jourMois(du)) + '→' + jourMois(au), perf: 'PERF-' + du.slice(8, 10) + '→' + au.slice(8, 10) };
  }

  /* Une image PNG (une page) rendue hors écran */
  async function imageVendeurs(lignes, et) {
    if (!window.html2canvas) throw new Error('html2canvas indisponible');
    const ligne = (a) => CT.h('tr', { class: a.champion ? 'champion' : null }, CT.h('td', {}, a.equipe), CT.h('td', {}, a.login), CT.h('td', {}, CT.fmt.nat(Math.round(a.objPeriode * 10) / 10)),
      CT.h('td', { class: 'n' }, String(a.ventesJour)), CT.h('td', { class: 'n perf' }, Math.round(a.realisation * 100) + '%'));
    const feuille = CT.h('div', { class: 'capture-xl', 'aria-hidden': 'true' }, CT.h('table', {},
      CT.h('thead', {}, CT.h('tr', {}, CT.h('th', {}, 'Équipe'), CT.h('th', { class: 'h-login' }, 'Étiquettes de lignes'), CT.h('th', { class: 'h-obj' }, et.obj),
        CT.h('th', { class: 'h-ventes' }, et.ventes), CT.h('th', { class: 'h-perf' }, et.perf))),
      CT.h('tbody', {}, lignes.map(ligne))));
    document.body.append(feuille);
    try {
      const canvas = await html2canvas(feuille, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true,
        onclone: (doc, cible) => CT.couleursCompatibles(cible) });   // l'élément cloné exact (pas un querySelector)
      return await new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('Image vide'))), 'image/png'));
    } finally { feuille.remove(); }
  }

  const ouvrirWhatsApp = () => window.open(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'https://api.whatsapp.com/send' : 'https://web.whatsapp.com/', '_blank', 'noopener');

  async function copierImage(image, nomImage) {
    if (navigator.clipboard && window.ClipboardItem) {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]); return true; } catch (e) { console.warn('Presse-papier refusé :', e); }
    }
    CT.telecharger(image, nomImage);   // presse-papier indisponible : l'image est téléchargée à la place
    return false;
  }

  // Vendeurs à 100 % ou plus de leur objectif sur la période filtrée, le champion en tête (tableau du haut et image)
  const vendeursA100 = (agents) => agents.filter((a) => a.realisation != null && a.realisation >= 1 - 1e-9)
    .sort((a, b) => (b.champion ? 1 : 0) - (a.champion ? 1 : 0) || a.login.localeCompare(b.login));

  async function copierTableauAgents(m, agents) {
    const lignes = vendeursA100(agents);
    if (!lignes.length) { CT.modal({ titre: 'Copier l\'image du tableau des agents', corps: '<p>Aucun vendeur n\'a atteint 100 % de son objectif ' + (m.estPlage ? 'sur la période' : 'ce jour-là') + ' : pas d\'image à copier.</p>' }); return; }
    // Pages équilibrées de 15 lignes au plus (ex. 22 vendeurs → 11 + 11) : la même fenêtre s'ouvre pour chaque image, l'une après l'autre
    const nb = Math.ceil(lignes.length / LIGNES_PAR_IMAGE), taille = Math.ceil(lignes.length / nb), et = enTetesCapture(m);
    for (let i = 0; i < nb; i++) {
      const suite = nb > 1 ? ' (image ' + (i + 1) + '/' + nb + ')' : '';
      const nomImage = 'Point_du_jour_agents_' + (m.jourDu ? m.jourDu + '_au_' : '') + m.jourRef + (nb > 1 ? '_' + (i + 1) : '') + '.png';
      if (!(await fenetreImage(imageVendeurs(lignes.slice(i * taille, (i + 1) * taille), et), nomImage, suite))) break;   // Annuler : on s'arrête
    }
  }

  async function fenetreImage(imagePromise, nomImage, suite) {
    const coller = /Mac/i.test(navigator.platform || navigator.userAgent) ? '⌘+V' : 'Ctrl+V';
    const apercu = CT.h('div', { class: 'apercu-image' }, CT.h('div', { class: 'apercu-attente' }, CT.h('span', { class: 'skeleton' }), 'Préparation de l\'image du tableau…'));
    const corps = CT.h('div', {});
    corps.innerHTML = `<ol class="etapes">
        <li><span><b>Vérifiez l'image</b> ci-dessous : cliquez dessus pour zoomer, faites défiler pour tout voir.</span></li>
        <li><span><b>Cliquez sur « Copier l'image »</b> : le tableau est placé dans le presse-papier.</span></li>
        <li><span><b>Dans WhatsApp</b>, ouvrez la discussion ou le groupe, cliquez dans la zone de saisie, faites <b>${coller}</b> puis Envoyer.</span></li>
      </ol>`;
    const lienGrand = CT.h('a', { class: 'mini-cap', target: '_blank', rel: 'noopener', hidden: true }, 'Ouvrir l\'image en grand ↗');
    corps.append(apercu, lienGrand);

    const image = imagePromise.catch((e) => { console.warn('Capture du tableau impossible :', e); return null; });
    const fenetre = CT.modal({ titre: 'Copier l\'image du tableau des agents' + suite, corps, actions: [
      { label: 'Annuler', valeur: false },
      { label: 'Copier et ouvrir WhatsApp', valeur: 'whatsapp', variante: 'wa' },
      { label: 'Copier l\'image', valeur: 'copier', variante: 'primary' }] });
    // Boutons de copie inactifs tant que l'image n'est pas prête
    const boutons = [...document.querySelectorAll('dialog.modal .modal-foot button')].slice(1);
    boutons.forEach((b) => { b.disabled = true; });

    let url = null;
    image.then((b) => {
      if (!b) { apercu.replaceChildren(CT.h('div', { class: 'alert neg' }, CT.h('div', {}, CT.h('strong', {}, 'Image du tableau indisponible'), CT.h('span', {}, 'Détail dans la console du navigateur (F12).')))); return; }
      url = URL.createObjectURL(b);
      const img = CT.h('img', { src: url, alt: 'Tableau des agents qui sera copié', title: 'Cliquer pour zoomer / dézoomer' });
      img.addEventListener('click', () => apercu.classList.toggle('zoom'));   // vue d'ensemble ↔ taille lisible
      apercu.replaceChildren(img);
      lienGrand.href = url; lienGrand.hidden = false;
      boutons.forEach((x) => { x.disabled = false; });
    });

    const choix = await fenetre;
    const b = await image;
    if (choix && b) {
      const copie = await copierImage(b, nomImage);   // copie AVANT d'ouvrir WhatsApp (le nouvel onglet prend le focus)
      if (choix === 'whatsapp') ouvrirWhatsApp();
      CT.toast(copie ? 'Image du tableau copiée ✔ Dans WhatsApp : ouvrez la discussion puis faites ' + coller + ' pour la coller.'
        : 'Copie impossible : l\'image a été téléchargée. Joignez-la avec le trombone 📎 de WhatsApp.', copie ? 'ok' : 'warn', 12000);
    }
    setTimeout(() => url && URL.revokeObjectURL(url), 60000);   // laisse le temps à « Ouvrir en grand »
    return !!choix;
  }

  CT.pointJour = {
    render() {
      const e = E(), root = document.getElementById('pj-content');
      if (!e.lignes.length) { root.innerHTML = ''; return; }

      // La période (début → fin) est calculée une seule fois dans app.js (etat.motivPJ) : mêmes chiffres à l'écran et dans les exports
      const m = e.motivPJ, pl = m.estPlage, per = pl ? 'de la période' : 'du jour';
      const r = m.reseau, pr = e.prioritaire, mn = CT.fmt.int;
      const quand = pl ? 'du ' + CT.date.court(m.jourDu) + ' au ' + CT.date.court(e.jourRef) : 'le ' + CT.date.long(e.jourRef);
      // Un login hors objectif n'apparaît dans le point du jour que s'il a vendu ce jour-là
      const agentsJour = m.agents.filter((a) => !a.horsObjectif || a.ventesJour > 0);
      const att = CT.calc.pointsAttention(m, e.lignes); e.attention = att;
      const msg = CT.calc.messageWhatsApp(m); e.messageWa = msg;
      // Période choisie : calcul commun (app.js), mêmes montants que le tableau RGZ et la Performance ; sans date de début : la seule journée
      const cp = e.periodeDu ? e.primesPeriode : CT.calc.commissionsPrimes(e.lignes, { cle: e.cle, du: m.jourDu, au: e.jourRef, partenaire: pr, motiv: m, mode: 'periode' }); e.primesPJ = cp;
      const primV = CT.somme(cp.equipes, (q) => q.primeB2CVendeurs + q.primeB2BVendeurs), primS = CT.somme(cp.equipes, (q) => q.primeEquipe + q.primeObjectif), prim = primV + primS;
      const eqOk = m.equipes.filter((x) => x.jourReussie).length;
      const aTraiter = att.filter((x) => !/^Objectif (du jour|de la période)/.test(x.sujet)).length;

      const onglets = CT.ui.onglets({ cle: 'pointjour', rendu: (id, zone) => RUBRIQUES[id](zone), onglets: [
        { id: 'resume', icone: 'fa-house', titre: 'Résumé', aide: 'L\'essentiel' },
        { id: 'equipes', icone: 'fa-people-group', titre: 'Équipes', aide: eqOk + ' / ' + m.equipes.length + ' à l\'objectif' },
        { id: 'vendeurs', icone: 'fa-user-tie', titre: 'Vendeurs', aide: r.agentsAtteints + ' à l\'objectif' },
        { id: 'primes', icone: 'fa-sack-dollar', titre: 'Commissions & primes', aide: 'Qui gagne combien' },
        { id: 'objectifs', icone: 'fa-bullseye', titre: 'Objectifs', aide: 'Jour, semaine, mois' },
        { id: 'attention', icone: 'fa-triangle-exclamation', titre: 'À surveiller', aide: aTraiter ? aTraiter + ' point(s)' : 'Rien à signaler', ton: aTraiter ? 'warn' : '' }] });

      const RUBRIQUES = {
        resume(zone) {
          // Jour ouvré précédent (point d'une seule journée) : pour dire « mieux / moins bien qu'hier »
          const R = m.regles, compte = (l) => (R.statuts_comptes || ['OK']).includes(l.statut);
          let veille = null;
          if (!pl) { for (let d = CT.date.parse(e.jourRef), i = 0; i < 10 && !veille; i++) { d = new Date(d.getTime() - 864e5); const j = CT.date.str(d); if (j.slice(0, 7) === e.cle && CT.objectifs.estOuvre(m.objectifs, j)) veille = j; } }
          const ventesVeille = veille ? e.lignes.filter((l) => l.partenaire === pr && compte(l) && l.jour === veille).length : null;
          const evol = ventesVeille == null ? null : r.ventesJour - ventesVeille;
          const sansObj = !r.objPeriode, ton = sansObj ? 'info' : CT.ui.tonDe(r.realisation);
          const verdict = !m.ouvre ? 'Jour non ouvré : les ventes comptent pour le mois, sans prime journalière.'
            : sansObj ? 'Objectif ' + per + ' non renseigné : pas de taux de réalisation.'
            : r.realisation >= 1 ? 'Objectif ' + per + ' atteint : ' + CT.fmt.pct(r.realisation, 0) + ' !' : r.realisation >= 0.6 ? 'Presque : ' + CT.fmt.pct(r.realisation, 0) + ' de l\'objectif ' + per + '.' : 'En dessous : seulement ' + CT.fmt.pct(r.realisation, 0) + ' de l\'objectif ' + per + '.';
          const reussies = m.equipes.filter((q) => q.jourReussie), aZero = m.equipes.filter((q) => q.objMois > 0 && q.ventesJour === 0);
          const enCours = m.equipes.filter((q) => !q.jourReussie && q.ventesJour > 0);
          const top = [...agentsJour].filter((a) => a.ventesJour > 0).sort((a, b) => b.ventesJour - a.ventesJour || (b.realisation || 0) - (a.realisation || 0));
          const actions = att.filter((x) => !/^Objectif (du jour|de la période)/.test(x.sujet)).slice(0, 3);
          const chip = (q, cls) => `<span class="chip-eq ${cls}">${CT.esc(q.id)} <b class="num">${mn(q.ventesJour)}${q.objPeriode ? ' / ' + CT.fmt.nat(Math.round(q.objPeriode * 10) / 10) : ''}</b></span>`;
          zone.innerHTML = `<div class="stack">
            <section class="verdict ${ton}"><span class="verdict-ic" aria-hidden="true"><i class="fa-solid ${ton === 'pos' ? 'fa-circle-check' : ton === 'neg' ? 'fa-circle-exclamation' : ton === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i></span>
              <div><span class="eyebrow">${pl ? 'Période ' + CT.esc(CT.periode.texte()) : CT.esc(CT.date.long(e.jourRef))}</span><h2>${CT.esc(verdict)}</h2>
              <p>${CT.esc(pr)} : <b>${mn(r.ventesJour)} vente(s)</b> ${per}${sansObj ? '' : ' pour un objectif de <b>' + CT.fmt.nat(Math.round(r.objPeriode * 10) / 10) + '</b>'}${evol == null ? '' : ` · <span class="${evol >= 0 ? 'txt-pos' : 'txt-neg'}">${evol >= 0 ? '▲ +' : '▼ '}${mn(evol)} par rapport au ${CT.esc(CT.date.court(veille))} (${mn(ventesVeille)})</span>`}${m.champion ? ' · champion : <b>' + CT.esc(CT.loginCourt(m.champion.login)) + '</b>' : ''}</p></div>
              ${sansObj ? '' : `<div class="verdict-jauge"><b class="num">${CT.fmt.pct(r.realisation, 0)}</b>${CT.ui.jauge(r.realisation, 'Réalisation')}</div>`}</section>
            <div class="grid-tuiles">
              ${CT.ui.tuile({ icone: 'fa-calendar', ton: CT.ui.tonDe(r.tro), titre: m.multiMois ? 'Cumul de la période' : 'Cumul du mois', valeur: mn(r.real) + ' / ' + mn(r.objMois), p: r.tro, aide: CT.fmt.pct(r.tro, 0) + ' · reste ' + mn(Math.max(0, r.objMois - r.real)) + ' vente(s)' })}
              ${CT.ui.tuile({ icone: 'fa-people-group', ton: reussies.length ? 'pos' : 'warn', titre: 'Équipes à l\'objectif', valeur: reussies.length + ' / ' + m.equipes.length, aide: aZero.length ? aZero.length + ' équipe(s) sans aucune vente' : 'Toutes les équipes ont vendu' })}
              ${CT.ui.tuile({ icone: 'fa-user-check', ton: r.agentsAtteints ? 'pos' : '', titre: 'Vendeurs à l\'objectif', valeur: r.agentsAtteints + ' / ' + r.agentsAvecObjectif, aide: r.agentsVendeurs + ' ont vendu au moins une fois' })}
              ${CT.ui.tuile({ icone: 'fa-scale-unbalanced', titre: 'B2C / B2B ' + per, valeur: mn(cp.total.b2c) + ' / ' + mn(cp.total.b2b), aide: 'Particuliers / entreprises' })}
              ${CT.ui.tuile({ icone: 'fa-coins', ton: 'pos', titre: 'Commissions ' + per, valeur: CT.fmt.fcfa(cp.total.commissions), aide: 'Dont ' + CT.fmt.fcfa(cp.total.partenaire) + ' pour ' + CT.esc(pr) })}
              ${CT.ui.tuile({ icone: 'fa-sack-dollar', ton: prim ? 'pos' : '', titre: 'Primes ' + per, valeur: CT.fmt.fcfa(prim), aide: m.ouvre || prim ? 'Vendeurs ' + CT.fmt.fcfa(primV) + ' · superviseurs ' + CT.fmt.fcfa(primS) : 'Pas de prime (jour non ouvré)' })}
            </div>
            <div class="grid-2">
              <section class="card"><div class="card-head"><div><h3><i class="fa-solid fa-ranking-star" aria-hidden="true"></i> Podium ${per}</h3><p>Les vendeurs qui ont le plus vendu</p></div></div>
                ${CT.ui.podium(top.map((a) => ({ nom: CT.loginCourt(a.login) + (a.champion ? ' 🏆' : ''), sous: a.equipe + (a.objPeriode ? ' · ' + CT.fmt.pct(a.realisation, 0) + ' de son objectif' : ''), valeur: mn(a.ventesJour) + ' vente' + (a.ventesJour > 1 ? 's' : '') })))}
                ${top.length > 3 ? `<p class="mini-cap">Puis : ${top.slice(3, 8).map((a) => CT.esc(CT.loginCourt(a.login)) + ' (' + a.ventesJour + ')').join(', ')}${top.length > 8 ? '…' : ''}</p>` : ''}</section>
              <section class="card"><div class="card-head"><div><h3><i class="fa-solid fa-people-group" aria-hidden="true"></i> Les équipes en un coup d'œil</h3><p>Ventes / objectif ${per}</p></div></div>
                <div class="groupes-eq"><div><h5 class="txt-pos"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Ont réussi (${reussies.length})</h5><div class="chips">${reussies.map((q) => chip(q, 'ok')).join('') || '<span class="muted">Aucune</span>'}</div></div>
                  <div><h5><i class="fa-solid fa-person-running" aria-hidden="true"></i> En cours (${enCours.length})</h5><div class="chips">${enCours.map((q) => chip(q, '')).join('') || '<span class="muted">Aucune</span>'}</div></div>
                  <div><h5 class="txt-neg"><i class="fa-solid fa-phone" aria-hidden="true"></i> À relancer : aucune vente (${aZero.length})</h5><div class="chips">${aZero.map((q) => chip(q, 'ko')).join('') || '<span class="muted">Aucune, bravo</span>'}</div></div></div></section>
            </div>
            <section class="card"><div class="card-head"><div><h3>Ventes ${per} par équipe</h3><p>Barre grise = objectif ${per} · barre de couleur = ventes (vert = objectif atteint)</p></div></div><div class="chart-box"><canvas id="pj-ch-eq" role="img" aria-label="Ventes par équipe et objectif"></canvas></div></section>
            ${actions.length ? `<section class="card"><div class="card-head"><div><h3><i class="fa-solid fa-list-check" aria-hidden="true"></i> À faire maintenant</h3><p>Les ${actions.length} point(s) les plus importants · détail dans « À surveiller »</p></div></div>
              <ol class="actions">${actions.map((x) => `<li><b>${CT.esc(x.sujet)}</b><span>${CT.esc(x.action)}</span></li>`).join('')}</ol></section>` : ''}
            <section class="card"><div class="card-head"><div><h3>Message WhatsApp</h3><p>Aperçu tel qu'il apparaîtra dans le groupe</p></div><span class="badge badge-pos">Prêt à envoyer</span></div>
              <div class="wa-preview" aria-live="polite"><div class="wa-bubble"><div id="wa-apercu"></div><span class="wa-meta"><span id="wa-heure"></span> <svg viewBox="0 0 16 11" aria-hidden="true"><path d="M11.07.66 10.4.03 4.2 6.3 1.6 3.7 1 4.3l3.2 3.2zM15 .66l-.67-.63-6.2 6.27-.73-.73-.6.6 1.33 1.33z" fill="currentColor"/></svg></span></div></div>
              <details class="wa-edit"><summary>${CT.icone('crayon')}Modifier le message avant envoi</summary>
                <label class="sr-only" for="wa-msg">Message WhatsApp</label><textarea class="wa-box" id="wa-msg" rows="8"></textarea></details>
              <div style="margin-top:16px"><button class="btn btn-wa" id="wa-copy" type="button"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Copier le message</button></div></section>
          </div>`;
          const champ = zone.querySelector('#wa-msg'), apercu = zone.querySelector('#wa-apercu');
          // Aperçu : *gras* WhatsApp rendu en gras, retours à la ligne conservés ; le texte modifié est gardé entre deux rubriques
          const majApercu = () => { apercu.innerHTML = CT.esc(champ.value).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); };
          champ.value = e.messageWaEdite || msg.join('\n'); majApercu();
          champ.addEventListener('input', () => { e.messageWaEdite = champ.value; majApercu(); });
          zone.querySelector('#wa-heure').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          zone.querySelector('#wa-copy').addEventListener('click', () => CT.partage.copier(champ.value));
          // Graphique : ventes de chaque équipe (barres) et objectif (trait)
          const cs = getComputedStyle(document.documentElement), jt = (n) => cs.getPropertyValue(n).trim(), eqs = [...m.equipes].sort((x, y) => y.ventesJour - x.ventesJour);
          if (window.Chart) {
            Chart.defaults.color = jt('--text-2'); Chart.defaults.borderColor = jt('--border');
            if (graphe) graphe.destroy();
            graphe = new Chart(zone.querySelector('#pj-ch-eq'), { data: { labels: eqs.map((q) => q.id), datasets: [
              { type: 'bar', label: 'Objectif', data: eqs.map((q) => Math.round(q.objPeriode * 10) / 10), backgroundColor: jt('--surface-3'), borderColor: jt('--border-strong'), borderWidth: 1, borderRadius: 4, maxBarThickness: 30 },
              { type: 'bar', label: 'Ventes', data: eqs.map((q) => q.ventesJour), backgroundColor: eqs.map((q) => (q.jourReussie ? jt('--pos') : q.ventesJour ? jt('--series-1') : jt('--neg'))), borderRadius: 4, maxBarThickness: 30 }] },
              options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
          }
        },
        equipes(zone) {
          zone.innerHTML = `<div class="stack">${CT.ui.enClair(`Une équipe a <b>réussi</b> quand ses ventes ${per} atteignent son objectif ${per}. ${m.multiMois ? 'Période sur plusieurs mois : objectif de chaque mois ÷ ses jours ouvrés × ses jours ouvrés dans la période, puis additionné (' + m.ouvresPeriode + ' jour(s) ouvré(s)).' : pl ? 'Objectif de la période = objectif du mois ÷ ' + m.nbOuvres + ' × ' + m.ouvresPeriode + ' jour(s) ouvré(s).' : 'Objectif du jour = objectif du mois ÷ ' + m.nbOuvres + ' jours ouvrés.'}`, 'fa-people-group')}
            <div class="cartes-equipes">${[...m.equipes].sort((a, b) => (b.realisation || 0) - (a.realisation || 0)).map((q) => `<div class="carte-eq ${q.jourReussie ? 'ok' : ''}"><div class="carte-eq-tete"><b>${CT.esc(q.id)}</b>${CT.ui.pastille(q.jourReussie, 'Réussi', 'Pas encore')}</div>
              <div class="carte-eq-val num">${mn(q.ventesJour)} <small>/ ${mn(q.objPeriode)}</small></div>${CT.ui.jauge(q.realisation || 0, q.id)}<small class="muted">${q.agentsVendeurs} vendeur(s) actif(s) · ${q.agentsAtteints} à l'objectif</small></div>`).join('')}</div>
            <section class="card"><div class="card-head"><div><h3>Tableau des équipes — ${pl ? CT.periode.texte() : CT.date.long(e.jourRef)}</h3><p>Détail chiffré, identique à l'export Excel</p></div></div><div id="pj-eq"></div></section></div>`;
          const eq = CT.table.creer({ pageSize: 0, caption: 'Point du jour — équipes', classeLigne: (x) => (x.jourReussie ? 'row-rgz' : ''), lignes: m.equipes,
            colonnes: [{ cle: 'id', titre: 'Équipe' }, { cle: 'objMois', titre: 'Obj. mois', num: true, fmt: CT.fmt.int }, { cle: 'objSemaine', titre: 'Obj. semaine', num: true, fmt: CT.fmt.int }, { cle: 'objPeriode', titre: pl ? 'Obj. période' : 'Obj. jour', num: true, fmt: CT.fmt.int },
              { cle: 'ventesJour', titre: 'Ventes', num: true, fmt: CT.fmt.int }, { cle: 'realisation', titre: 'Réalisation', num: true, fmt: (v) => CT.fmt.pct(v, 1) },
              { cle: 'jourReussie', titre: pl ? 'Objectif atteint' : 'Journée réussie', html: true, fmt: oui }, { cle: 'agentsAvecObjectif', titre: 'Agents avec obj.', num: true }, { cle: 'agentsVendeurs', titre: 'Agents ayant vendu', num: true },
              { cle: 'agentsAtteints', titre: 'Agents obj. atteint', num: true }, { cle: 'primeSupJour', titre: 'Prime superviseur (FCFA)', num: true, fmt: CT.fmt.mnt }],
            pied: { id: 'RÉSEAU', objMois: r.objMois, objSemaine: r.objSemaine, objPeriode: r.objPeriode, ventesJour: r.ventesJour, realisation: r.realisation, jourReussie: '', agentsAvecObjectif: r.agentsAvecObjectif, agentsVendeurs: r.agentsVendeurs, agentsAtteints: r.agentsAtteints, primeSupJour: r.primeSupJour } });
          zone.querySelector('#pj-eq').append(eq.el);
        },
        vendeurs(zone) {
          const a100 = vendeursA100(agentsTries);
          zone.innerHTML = `<div class="stack">${CT.ui.enClair(`<b>${r.agentsAtteints}</b> vendeur(s) sur ${r.agentsAvecObjectif} ont atteint leur objectif ${per}. Le champion est en tête, suivi de son équipe. La colonne « Total primes » est ce que chacun a gagné ${per}.`, 'fa-user-tie')}
            <section class="card"><div class="card-head"><div><h3><i class="fa-solid fa-circle-check txt-pos" aria-hidden="true"></i> Vendeurs à 100 % ou plus</h3><p><b>Seulement les vendeurs qui ont atteint 100 % ou plus de leur objectif ${per}</b> · ${a100.length} vendeur(s) · champion en tête</p></div><button class="btn btn-wa btn-sm no-print" id="pj-ag-copie" type="button"><i class="fa-regular fa-copy" aria-hidden="true"></i>Copier l'image du tableau</button></div><div id="pj-ag100"></div></section>
            <section class="card"><div class="card-head"><div><h3>Tous les vendeurs</h3><p>${agentsJour.filter((a) => a.ventesJour > 0).length} vendeur(s) avec au moins une vente · ${agentsJour.length} ligne(s)</p></div></div><div id="pj-ag"></div></section></div>`;
          if (a100.length) zone.querySelector('#pj-ag100').append(CT.table.creer({ pageSize: 20, recherche: true, caption: 'Point du jour — vendeurs à 100 % ou plus', classeLigne: (x) => (x.champion ? 'row-rgz' : ''), lignes: a100, colonnes: colsAgents }).el);
          else zone.querySelector('#pj-ag100').append(CT.h('p', { class: 'mini-cap' }, 'Aucun vendeur n\'a atteint 100 % de son objectif ' + per + '.'));
          const ag = CT.table.creer({ pageSize: 20, recherche: true, caption: 'Point du jour — agents', classeLigne: (x) => (x.champion ? 'row-rgz' : ''), lignes: agentsTries, colonnes: colsAgents });
          zone.querySelector('#pj-ag').append(ag.el);
          zone.querySelector('#pj-ag-copie').addEventListener('click', () => copierTableauAgents(m, agentsTries));
        },
        primes(zone) {
          zone.innerHTML = `<div class="stack">${CT.ui.enClair(`Ce que rapportent les ventes ${quand} : <b>${CT.fmt.fcfa(cp.total.commissions)}</b> de commissions et <b>${CT.fmt.fcfa(cp.total.primes)}</b> de primes. Les primes de fin de mois (paliers, bonus B2B, trophée) sont dans <b>Performance › Commissions</b>.`, 'fa-sack-dollar')}
            ${CT.ui.grillePrimes(cp, pr)}
            <section class="card"><div class="card-head"><div><h3>Par équipe</h3><p>Commissions et primes de chaque équipe, ventes B2C et B2B séparées</p></div></div><div id="pj-primes-eq"></div></section>
            <section class="card"><div class="card-head"><div><h3>Qui touche combien ${per}</h3><p>Commission des ventes ${per} + primes ${per}</p></div></div><div id="pj-gains"></div></section>
            <section class="card"><div class="card-head"><div><h3>Barème : comment on gagne</h3><p>Règles du plan de motivation (modifiables dans Paramètres)</p></div></div>${CT.ui.bareme(m.regles, m.comm)}</section></div>`;
          zone.querySelector('#pj-primes-eq').append(CT.ui.tablePrimesEquipes(cp, pr).el);
          zone.querySelector('#pj-gains').append(CT.ui.tableGains(cp, pr).el);
        },
        objectifs(zone) {
          zone.innerHTML = `<div class="stack">${CT.ui.enClair(`Chaque équipe a un objectif <b>du jour</b>, <b>de la semaine</b> et <b>du mois</b>. La barre montre où en est le mois : vert = atteint, bleu = bien parti, orange = en retard, rouge = très en retard.`, 'fa-bullseye')}
            <div class="grid-tuiles">
              ${CT.ui.tuile({ icone: 'fa-calendar-day', ton: CT.ui.tonDe(r.realisation), titre: pl ? 'Objectif de la période' : 'Objectif du jour', valeur: mn(r.objPeriode), p: r.realisation || 0, aide: mn(r.ventesJour) + ' vente(s) faite(s)' })}
              ${(() => { const sw = CT.periode.semaine(); return CT.ui.tuile({ icone: 'fa-calendar-week', ton: CT.ui.tonDe(sw.objectif ? sw.ventes / sw.objectif : null), titre: 'Semaine', valeur: mn(sw.ventes) + ' / ' + mn(sw.objectif), p: sw.objectif ? sw.ventes / sw.objectif : null, aide: 'Du ' + CT.date.court(sw.du) + ' au ' + CT.date.court(e.jourRef) + ' · toutes équipes' }); })()}
              ${CT.ui.tuile({ icone: 'fa-calendar', ton: CT.ui.tonDe(r.tro), titre: m.multiMois ? 'Objectifs des mois' : 'Objectif du mois', valeur: mn(r.objMois), p: r.tro, aide: mn(r.real) + ' faites · reste ' + mn(Math.max(0, r.objMois - r.real)) })}
            </div>
            <section class="card"><div class="card-head"><div><h3>Objectifs par équipe</h3><p>${m.multiMois ? CT.date.libelleMois(m.segments[0].cle) + ' → ' + CT.date.libelleMois(e.cle) + ' · objectifs de chaque mois additionnés' : CT.date.libelleMois(e.cle) + ' · ' + m.nbOuvres + ' jours ouvrés dans le mois'}</p></div></div><div id="pj-obj"></div></section></div>`;
          const t = CT.table.creer({ pageSize: 0, caption: 'Objectifs par équipe', lignes: m.equipes, triInit: { cle: 'tro', dir: 'desc' },
            colonnes: [{ cle: 'id', titre: 'Équipe' }, { cle: 'objPeriode', titre: pl ? 'Obj. période' : 'Obj. jour', num: true, fmt: mn }, { cle: 'ventesJour', titre: pl ? 'Ventes période' : 'Ventes jour', num: true, fmt: mn },
              { cle: 'objSemaine', titre: 'Obj. semaine', num: true, fmt: mn }, { cle: 'objMois', titre: m.multiMois ? 'Obj. des mois' : 'Obj. mois', num: true, fmt: mn }, { cle: 'real', titre: m.multiMois ? 'Réalisé période' : 'Réalisé mois', num: true, fmt: mn },
              { cle: 'tro', titre: 'Avancement du mois', html: true, fmt: (v) => `<div class="cellule-jauge">${CT.ui.jauge(v)}<span class="num">${CT.fmt.pct(v, 0)}</span></div>` },
              { cle: 'reste', titre: 'Reste à faire', num: true, tri: (q) => Math.max(0, q.objMois - q.real), fmt: (v, q) => mn(Math.max(0, q.objMois - q.real)) }],
            pied: { id: 'RÉSEAU', objPeriode: r.objPeriode, ventesJour: r.ventesJour, objSemaine: r.objSemaine, objMois: r.objMois, real: r.real, tro: '', reste: '' } });
          zone.querySelector('#pj-obj').append(t.el);
        },
        attention(zone) {
          // Encadrés : bleu = information de calcul, ambre = point à traiter
          const ton = (sujet) => (/^Objectif (du jour|de la période)/.test(sujet) ? 'info' : 'warn');
          zone.innerHTML = `<div class="stack">${CT.ui.enClair(aTraiter ? `<b>${aTraiter} point(s)</b> demandent une action. Chaque encadré dit ce qui se passe et quoi faire.` : 'Rien d\'anormal à signaler. Les encadrés bleus expliquent seulement le calcul.', aTraiter ? 'fa-triangle-exclamation' : 'fa-face-smile')}
            <section class="card"><ul class="callouts">${att.map((x) => `<li class="callout ${ton(x.sujet)}"><span class="callout-ic">${CT.icone(ton(x.sujet) === 'info' ? 'info' : 'alerte')}</span>
              <div><strong>${CT.esc(x.sujet)}</strong><p>${CT.esc(x.constat)}</p><p class="callout-action">${CT.icone('ampoule')}<span>${CT.esc(x.action)}</span></p></div></li>`).join('')}</ul></section></div>`;
        },
      };

      // Mettre le champion en première position, puis son équipe, puis les autres par équipe
      const champion = agentsJour.find((a) => a.champion);
      const equipeChampion = champion ? champion.equipe : null;
      const agentsTries = [...agentsJour].sort((a, b) => {
        // Champion en premier
        if (a.champion) return -1;
        if (b.champion) return 1;
        // Membres de l'équipe du champion en second
        if (equipeChampion && a.equipe === equipeChampion && b.equipe !== equipeChampion) return -1;
        if (equipeChampion && b.equipe === equipeChampion && a.equipe !== equipeChampion) return 1;
        // Ensuite trier par équipe
        if (a.equipe < b.equipe) return -1;
        if (a.equipe > b.equipe) return 1;
        // Puis par login au sein de l'équipe
        return a.login.localeCompare(b.login);
      });
      const colsAgents = [{ cle: 'equipe', titre: 'Équipe' }, { cle: 'login', titre: 'Login' }, { cle: 'objMois', titre: 'Obj. mois', num: true, fmt: CT.fmt.int }, { cle: 'objSemaine', titre: 'Obj. semaine', num: true, fmt: CT.fmt.int }, { cle: 'objPeriode', titre: pl ? 'Obj. période' : 'Obj. jour', num: true, fmt: CT.fmt.int },
          { cle: 'ventesJour', titre: pl ? 'Ventes de la période' : 'Ventes du jour', num: true, fmt: CT.fmt.int }, { cle: 'realisation', titre: 'Réalisation', num: true, fmt: (v) => (v == null ? 'n/a' : CT.fmt.pct(v, 1)) },
          { cle: 'statutJour', titre: 'Objectif atteint', html: true, fmt: (v) => (v === 'Oui' ? '<span class="badge badge-pos">Oui</span>' : '<span class="badge">' + CT.esc(v) + '</span>') },
          { cle: 'champion', titre: pl ? 'Champion période' : 'Champion', html: true, fmt: (v) => (v ? '<span class="badge badge-rgz"><i class="fa-solid fa-trophy" aria-hidden="true"></i> Champion</span>' : '') },
          { cle: 'primeJour', titre: pl ? 'Primes journées (FCFA)' : 'Prime journée (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'primeChampion', titre: pl ? 'Primes champion (FCFA)' : 'Prime champion (FCFA)', num: true, fmt: CT.fmt.mnt }, { cle: 'totalPrimesJour', titre: 'Total primes (FCFA)', num: true, fmt: CT.fmt.mnt }];

      e.messageWaEdite = null;   // nouvelles données : le message repart de la version calculée
      root.replaceChildren(onglets);
      onglets.premier();
    },
    resume() { const e = E(); return e.messageWaEdite || (e.messageWa || CT.calc.messageWhatsApp(e.motivPJ)).join('\n'); },
    feuilles() {
      const e = E(), m = e.motivPJ, r = m.reseau, pl = m.estPlage;
      const att = e.attention || CT.calc.pointsAttention(m, e.lignes);
      const suf = pl ? e.jourDu.slice(8) + '-' + e.jourDu.slice(5, 7) + ' au ' + e.jourRef.slice(8) + '-' + e.jourRef.slice(5, 7) : e.jourRef.slice(8) + '-' + e.jourRef.slice(5, 7);
      // Ligne TOTAL de la feuille Agents : sommes des colonnes additives ; Réalisation = ventes totales ÷ objectif total (pas une somme de pourcentages)
      const totalAgents = (lignes) => {
        const tot = (c) => lignes.reduce((s, l) => s + (typeof l[c] === 'number' ? l[c] : 0), 0);
        return lignes.concat([['TOTAL', CT.fmt.int(lignes.length) + ' agents', tot(2), tot(3), tot(4), tot(5), tot(4) > 0 ? tot(5) / tot(4) : null, '', '', tot(9), tot(10), tot(11)]]);
      };
      return [
        { nom: 'Équipes ' + suf, cols: [14, 10, 10, 10, 8, 12, 14, 16, 18, 18, 18],
          aoa: [['Équipe', 'Obj. mois', 'Obj. semaine', pl ? 'Obj. période' : 'Obj. jour', 'Ventes', 'Réalisation', pl ? 'Objectif atteint' : 'Journée réussie', 'Agents avec objectif', 'Agents ayant vendu', 'Agents objectif atteint', 'Prime superviseur (FCFA)']]
            .concat(m.equipes.map((x) => [x.id, x.objMois, x.objSemaine, x.objPeriode, x.ventesJour, x.realisation, x.jourReussie ? 'Oui' : 'Non', x.agentsAvecObjectif, x.agentsVendeurs, x.agentsAtteints, x.primeSupJour]))
            .concat([['RÉSEAU', r.objMois, r.objSemaine, r.objPeriode, r.ventesJour, r.realisation, '', r.agentsAvecObjectif, r.agentsVendeurs, r.agentsAtteints, r.primeSupJour]]) },
        { nom: 'Agents ' + suf, cols: [12, 30, 10, 10, 10, 12, 12, 16, 10, 12, 14, 12],
          aoa: [['Équipe', 'Login', 'Obj. mois', 'Obj. semaine', pl ? 'Obj. période' : 'Obj. jour', pl ? 'Ventes de la période' : 'Ventes du jour', 'Réalisation', 'Objectif atteint', 'Champion', pl ? 'Primes journées (FCFA)' : 'Prime journée (FCFA)', pl ? 'Primes champion (FCFA)' : 'Prime champion (FCFA)', 'Total primes (FCFA)']]
            .concat(totalAgents(m.agents.filter((a) => !a.horsObjectif || a.ventesJour > 0).sort((a, b) => {
              // Champion en premier
              if (a.champion) return -1;
              if (b.champion) return 1;
              // Membres de l'équipe du champion en second
              const equipeChampion = m.champion ? m.champion.equipe : null;
              if (equipeChampion && a.equipe === equipeChampion && b.equipe !== equipeChampion) return -1;
              if (equipeChampion && b.equipe === equipeChampion && a.equipe !== equipeChampion) return 1;
              // Ensuite trier par équipe
              if (a.equipe < b.equipe) return -1;
              if (a.equipe > b.equipe) return 1;
              // Puis par login au sein de l'équipe
              return a.login.localeCompare(b.login);
            }).map((a) => [a.equipe, a.login, a.objMois, a.objSemaine, a.objPeriode, a.ventesJour, a.realisation, a.statutJour, a.champion ? 'Champion' : '', a.primeJour, a.primeChampion, a.totalPrimesJour]))) },
        CT.ui.feuillePrimes(e.primesPJ || CT.calc.commissionsPrimes(e.lignes, { cle: e.cle, du: m.jourDu, au: e.jourRef, partenaire: e.prioritaire, motiv: m, mode: 'periode' }), 'Commissions et primes', e.prioritaire),
        { nom: "Points d'attention", cols: [24, 90, 90], aoa: [['Sujet', 'Constat', 'Action']].concat(att.map((x) => [x.sujet, x.constat, x.action])) },
        { nom: 'Message WhatsApp', cols: [120], aoa: [['Message']].concat((e.messageWa || CT.calc.messageWhatsApp(m)).map((x) => [x])) },
        { nom: 'Paramètres', cols: [34, 20], aoa: [['Paramètre', 'Valeur'], [pl ? 'Période du point' : 'Date du point', pl ? CT.date.court(e.jourDu) + ' au ' + CT.date.court(e.jourRef) : CT.date.court(e.jourRef)], ['Jours ouvrés du mois', m.nbOuvres], [pl ? 'Jours ouvrés de la période' : 'Jour ouvré ?', pl ? m.ouvresPeriode : (m.ouvre ? 'Oui' : 'Non')],
          ['Journée réussie (agent)', m.regles.agent.journee_reussie], ['Champion du jour', m.regles.agent.champion_du_jour.prime], ['Journée équipe (superviseur)', m.regles.superviseur.journee_equipe], ['Ventes comptées', (m.regles.statuts_comptes || []).join(', ')]] },
      ];
    },
  };
})();
