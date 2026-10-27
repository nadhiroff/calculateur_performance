/* ============================================================================
   parametres.js — module Paramètres : CRUD des objectifs (par mois), des règles de motivation,
   des partenaires, import/export Excel et JSON, sauvegarde et réinitialisation.
   Chaque modification est enregistrée en base de données MySQL via l'API Laravel.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const { h, $, $$ } = CT;
  let cle = null, filtre = '', onglet = 'obj';
  const P = () => CT.store.get().periodes[cle];
  const nombre = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

  /* ---------- Enregistrement (anti-rebond) ---------- */
  const enregistrer = CT.debounce(() => { CT.store.sauver('parametres'); $('#statut').textContent = '· Enregistré à ' + new Date().toLocaleTimeString('fr-FR'); }, 250);

  /* ---------- Cellule éditable : double-clic ou Entrée → champ ; Entrée/blur valide ; Échap annule ---------- */
  function cellule({ val, fmt, num, label, onCommit, min = 0 }) {
    const aff = () => (fmt ? fmt(val) : val == null || val === '' ? '—' : val);
    const td = h('td', { class: num ? 'num' : '', tabindex: '0', role: 'gridcell', title: 'Double-clic (ou Entrée) pour modifier', 'aria-label': label ? label + ' : ' + aff() : null }, String(aff()));
    const edit = () => {
      const inp = h('input', { class: 'input input-sm', type: num ? 'number' : 'text', step: 'any', value: val == null ? '' : val, 'aria-label': label || 'Valeur' });
      td.replaceChildren(inp); inp.focus(); inp.select(); let fini = false;
      const fin = (ok) => {
        if (fini) return; fini = true;
        if (ok) { const v = num ? nombre(inp.value) : inp.value.trim(); if (num && v < min) { CT.toast('La valeur doit être ≥ ' + min + '.', 'warn', 3000); } else if (!num && !v) { CT.toast('Ce champ ne peut pas être vide.', 'warn', 3000); } else if (v !== val) { onCommit(v); return; } }
        td.textContent = String(aff());
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fin(true); } else if (e.key === 'Escape') fin(false); });
      inp.addEventListener('blur', () => fin(true));
    };
    td.addEventListener('dblclick', edit);
    td.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === td) { e.preventDefault(); edit(); } });
    return td;
  }
  const bouton = (icone, label, fn, cls = 'btn-ghost btn-sm') => h('button', { class: 'btn ' + cls, type: 'button', title: label, 'aria-label': label, onclick: fn }, h('i', { class: 'fa-solid ' + icone, 'aria-hidden': 'true' }));
  const entete = (cols) => h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col', class: (c.num ? 'num' : '') + (c.auto ? ' col-auto' : ''), title: c.auto ? 'Calculé automatiquement à partir des ventes en base' : null }, c.t))));

  /* ---------- Fenêtres d'ajout : nouvelle équipe (nom, puis « ajouter des logins ? ») et objectifs d'un login ---------- */
  const NOUVELLE = '__nouvelle__';
  const valider = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); const b = e.target.closest('dialog').querySelector('.modal-foot .btn-primary'); if (b && !b.disabled) b.click(); } };

  /* Demande le nom et crée l'équipe ; renvoie son nom (null si annulé). proposerLogins : enchaîne sur l'ajout de logins */
  async function ajouterEquipe(proposerLogins = true) {
    let nom = '';
    for (;;) {
      const inp = h('input', { class: 'input', id: 'ae-nom', type: 'text', maxlength: '60', value: nom, placeholder: 'ex. ALPHA', autocomplete: 'off' });
      const corps = h('div', { class: 'field', onkeydown: valider }, h('label', { for: 'ae-nom' }, 'Nom de l\'équipe'), inp);
      setTimeout(() => inp.focus(), 50);
      const ok = await CT.modal({ titre: 'Nouvelle équipe', corps, actions: [{ label: 'Annuler', valeur: false }, { label: 'Créer l\'équipe', valeur: true, variante: 'primary' }] });
      if (!ok) return null;
      nom = inp.value.trim();
      const o = P().objectifs;
      if (!nom) { CT.toast('Saisissez le nom de l\'équipe.', 'warn', 3000); continue; }
      if (o.equipes.some((x) => x.id.toLowerCase() === nom.toLowerCase())) { CT.toast('Nom d\'équipe déjà utilisé.', 'warn', 3000); continue; }
      o.equipes.push({ id: nom, superviseur: null, segment: null, part_rgz: 0.2, logins: [] });
      enregistrer(); rendreTableObj();
      CT.toast('Équipe « ' + nom + ' » créée.', 'ok', 3000);
      break;
    }
    if (proposerLogins && await CT.modal({ titre: 'Ajouter des logins ?', corps: '<p>L\'équipe « <b>' + CT.esc(nom) + '</b> » est créée. Voulez-vous ajouter des logins à cette équipe maintenant ?</p>',
      actions: [{ label: 'Plus tard', valeur: false }, { label: 'Oui, ajouter des logins', valeur: true, variante: 'primary' }] })) await ajouterObjectifs(nom);
    return nom;
  }

  /* Objectifs d'un login : équipe, login, B2C / B2B (mois = somme), jour, semaine, primes. « Ajouter et continuer » garde l'équipe */
  async function ajouterObjectifs(equipeInit) {
    const vide = (eq) => ({ equipe: eq, login: '', b2c: '', b2b: '', jour: '', semaine: '', primes: true });
    let v = vide(equipeInit || (P().objectifs.equipes[0] || {}).id || NOUVELLE);
    for (;;) {
      const o = P().objectifs, mc = CT.objectifs.modeCalcul(o);
      const champ = (id, label, el, cls) => h('div', { class: 'field' + (cls ? ' ' + cls : '') }, h('label', { for: id }, label), el);
      const num = (id, val) => h('input', { class: 'input', id, type: 'number', min: '0', step: '1', inputmode: 'numeric', value: val, placeholder: '0' });
      const optEq = (id) => h('option', { value: id, selected: id === v.equipe }, id);
      const sel = h('select', { class: 'select', id: 'ao-eq' }, o.equipes.map((e) => optEq(e.id)), h('option', { value: NOUVELLE, selected: v.equipe === NOUVELLE }, '+ Nouvelle équipe…'));
      const login = h('input', { class: 'input', id: 'ao-login', type: 'text', value: v.login, placeholder: 'ex. pvt_rgz_nom.ftth', autocomplete: 'off', spellcheck: 'false' });
      const b2c = num('ao-b2c', v.b2c), b2b = num('ao-b2b', v.b2b);
      const mois = h('input', { class: 'input', id: 'ao-mois', type: 'text', readonly: true, tabindex: '-1' });
      const jour = num('ao-jour', mc ? '' : v.jour), sem = num('ao-sem', mc ? '' : v.semaine);
      if (mc) { jour.disabled = true; sem.disabled = true; }
      const primes = h('input', { type: 'checkbox', id: 'ao-primes', checked: v.primes });
      const maj = () => {
        const l = { b2c: Math.round(nombre(b2c.value)), b2b: Math.round(nombre(b2b.value)) }, aj = CT.objectifs.jourLogin(l, o), as = CT.objectifs.semLogin(l, o);
        mois.value = CT.fmt.int(l.b2c + l.b2b);
        const arr = (x) => CT.fmt.nat(Math.round(x * 10) / 10);
        if (mc) { jour.value = Math.round(aj * 10) / 10; sem.value = Math.round(as * 10) / 10; } else { jour.placeholder = 'auto : ' + arr(aj); sem.placeholder = 'auto : ' + arr(as); }
      };
      [b2c, b2b].forEach((x) => x.addEventListener('input', maj)); maj();
      // « + Nouvelle équipe… » : petite fenêtre du nom par-dessus, puis retour ici avec l'équipe choisie
      let precedente = v.equipe !== NOUVELLE ? v.equipe : null;
      sel.addEventListener('change', async () => {
        if (sel.value !== NOUVELLE) { precedente = sel.value; return; }
        const nom = await ajouterEquipe(false);
        if (nom) { sel.insertBefore(h('option', { value: nom }, nom), sel.lastChild); sel.value = nom; precedente = nom; } else sel.value = precedente || NOUVELLE;
      });
      const corps = h('div', { class: 'stack', onkeydown: valider },
        champ('ao-eq', 'Équipe', sel), champ('ao-login', 'Login de l\'agent', login),
        h('div', { class: 'form-grid' }, champ('ao-b2c', 'Objectif B2C (mois)', b2c), champ('ao-b2b', 'Objectif B2B (mois)', b2b), champ('ao-mois', 'Objectif du mois', mois)),
        h('div', { class: 'form-grid' }, champ('ao-jour', 'Objectif du jour', jour), champ('ao-sem', 'Objectif de la semaine', sem)),
        h('span', { class: 'hint' }, mc ? 'Jour et semaine calculés à partir de l\'objectif du mois (mode choisi plus haut).' : 'Jour et semaine : laissez vide pour le calcul automatique à partir de l\'objectif du mois.'),
        h('label', { class: 'check' }, primes, 'Éligible aux primes'));
      setTimeout(() => (sel.value === NOUVELLE || !o.equipes.length ? sel : login).focus(), 50);
      const choix = await CT.modal({ titre: 'Ajouter des objectifs — ' + CT.date.libelleMois(cle), corps, actions: [
        { label: 'Annuler', valeur: false }, { label: 'Ajouter et continuer', valeur: 'suite' }, { label: 'Ajouter', valeur: 'ok', variante: 'primary' }] });
      if (!choix) return;
      v = { equipe: sel.value, login: login.value.trim(), b2c: b2c.value, b2b: b2b.value, jour: mc ? '' : jour.value, semaine: mc ? '' : sem.value, primes: primes.checked };

      const eq = o.equipes.find((e) => e.id === v.equipe);
      const doublon = v.login && o.equipes.flatMap((e) => e.logins.map((l) => ({ e, l }))).find((x) => CT.cleLogin(x.l.login) === CT.cleLogin(v.login));
      if (!eq) { CT.toast('Choisissez une équipe (ou créez-en une).', 'warn', 4000); continue; }
      if (!v.login) { CT.toast('Saisissez le login de l\'agent.', 'warn', 4000); continue; }
      if (doublon) { CT.toast('Le login « ' + doublon.l.login + ' » existe déjà dans l\'équipe ' + doublon.e.id + '.', 'warn', 5000); continue; }
      const n = (x) => Math.max(0, Math.round(nombre(x)));
      eq.logins.push({ login: v.login, b2c: n(v.b2c), b2b: n(v.b2b), jour: n(v.jour), semaine: n(v.semaine), primes: v.primes });
      delete eq.fichier;   // les totaux de l'équipe repartent de ses logins (comme une modification dans le tableau)
      enregistrer(); rendreTableObj();
      CT.toast('Login « ' + v.login + ' » ajouté à ' + eq.id + '.', 'ok', 3000);
      if (choix !== 'suite') return;
      v = vide(eq.id);
    }
  }

  /* Petite fenêtre de saisie générique (paliers, partenaires…) : enregistrerFn(valeurs) renvoie un message d'erreur pour rester ouverte */
  async function fenetreAjout(titre, champs, enregistrerFn) {
    let vals = champs.map((c) => (c.val == null ? '' : c.val));
    for (;;) {
      const inputs = champs.map((c, i) => h('input', { class: 'input', id: 'fa-' + i, type: c.num ? 'number' : 'text', step: 'any', min: c.num ? '0' : null, inputmode: c.num ? 'decimal' : null, value: vals[i], placeholder: c.ph || '', autocomplete: 'off', spellcheck: 'false' }));
      const corps = h('div', { class: 'form-grid', onkeydown: valider }, champs.map((c, i) => h('div', { class: 'field' }, h('label', { for: 'fa-' + i }, c.t), inputs[i], c.aide ? h('span', { class: 'hint' }, c.aide) : null)));
      setTimeout(() => inputs[0] && inputs[0].focus(), 50);
      const ok = await CT.modal({ titre, corps, actions: [{ label: 'Annuler', valeur: false }, { label: 'Ajouter', valeur: true, variante: 'primary' }] });
      if (!ok) return false;
      vals = inputs.map((x) => x.value.trim());
      const manquant = champs.findIndex((c, i) => !c.num && !vals[i]);
      if (manquant >= 0) { CT.toast('Renseignez « ' + champs[manquant].t + ' ».', 'warn', 4000); continue; }
      const err = enregistrerFn(vals.map((x, i) => (champs[i].num ? Math.max(0, nombre(x)) : x)));
      if (err) { CT.toast(err, 'warn', 5000); continue; }
      return true;
    }
  }

  /* ============================== OBJECTIFS ============================== */
  function rendreObjectifs() {
    const o = P().objectifs, root = $('#p-obj');
    const q = filtre.toLowerCase();
    const jourMax = CT.objectifs.nbJoursOuvres(o), modeCalc = CT.objectifs.modeCalcul(o);
    // Calendrier
    const cal = h('div', { class: 'cal-grid', role: 'group', 'aria-label': 'Jours ouvrés de ' + CT.date.libelleMois(cle) });
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach((d) => cal.append(h('div', { class: 'dow', 'aria-hidden': 'true' }, d)));
    const premier = CT.date.dow(cle + '-01'); for (let i = 0; i < (premier + 6) % 7; i++) cal.append(h('div'));
    CT.date.joursDuMois(cle).forEach((j) => {
      const d = +j.slice(8), actif = o.calendrier.ouvres.includes(d);
      cal.append(h('button', { class: 'cal-day', type: 'button', 'aria-pressed': String(actif), 'aria-label': CT.date.long(j) + (actif ? ', ouvré' : ', non ouvré'),
        onclick: () => { const s = new Set(o.calendrier.ouvres); s.has(d) ? s.delete(d) : s.add(d); o.calendrier.ouvres = [...s].sort((a, b) => a - b); enregistrer(); rendreObjectifs(); } }, String(d)));
    });
    const comm = o.commission_one_shot || (o.commission_one_shot = { b2c: 0, b2b: 0 });
    const champComm = (k, l) => h('div', { class: 'field' }, h('label', { for: 'c-' + k }, l), h('input', { class: 'input', id: 'c-' + k, type: 'number', min: '0', value: comm[k], onchange: (e) => { comm[k] = Math.max(0, nombre(e.target.value)); enregistrer(); } }));
    const carteCal = h('section', { class: 'card', style: 'margin-bottom:24px' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Calendrier et commissions'), h('p', {}, 'Cliquez un jour pour le basculer. Les jours ouvrés servent au suivi (attendu à date, périodes, primes).'))),
      h('div', { style: 'display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))' }, h('div', {}, cal, h('p', { class: 'hint', style: 'margin-top:8px' }, jourMax + ' jours ouvrés')),
        h('div', { class: 'form-grid' }, champComm('b2c', 'Commission one-shot B2C (FCFA)'), champComm('b2b', 'Commission one-shot B2B (FCFA)'),
          h('div', { class: 'field' }, h('label', { for: 'c-mode' }, 'Objectifs jour / semaine'),
            h('select', { class: 'input', id: 'c-mode', onchange: (e) => { if (e.target.value === 'calcul') o.calendrier.mode_jour = 'calcul'; else delete o.calendrier.mode_jour; enregistrer(); rendreObjectifs(); } },
              h('option', { value: 'fichier', selected: !modeCalc }, 'Valeurs du fichier importé (par défaut)'), h('option', { value: 'calcul', selected: modeCalc }, 'Calculés à partir de l\'objectif du mois')),
            h('span', { class: 'hint' }, modeCalc ? 'Jour = mois ÷ base ; semaine = mois ÷ 4.' : 'Jour et semaine sont affichés exactement comme dans le fichier.')),
          modeCalc ? h('div', { class: 'field' }, h('label', { for: 'c-base' }, 'Base de l\'objectif journalier (jours)'), h('input', { class: 'input', id: 'c-base', type: 'number', min: '0', placeholder: String(jourMax), value: o.calendrier.base_jour || '', onchange: (e) => { const v = Math.max(0, Math.round(nombre(e.target.value))); if (v) o.calendrier.base_jour = v; else delete o.calendrier.base_jour; enregistrer(); rendreObjectifs(); } }),
            h('span', { class: 'hint' }, 'Vide = jours ouvrés (' + jourMax + '). Mettez 20 pour la convention du fichier « OBJECTIFS TRACKING ».')) : null)));
    // Barre d'outils
    const rech = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher un login ou une équipe…', 'aria-label': 'Rechercher', value: filtre, style: 'max-width:300px' });
    rech.addEventListener('input', CT.debounce(() => { filtre = rech.value; rendreTableObj(); }, 150));
    const outils = h('div', { class: 'table-tools' }, rech,
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => ajouterObjectifs() }, h('i', { class: 'fa-solid fa-bullseye', 'aria-hidden': 'true' }), 'Ajouter des objectifs'),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => ajouterEquipe() }, h('i', { class: 'fa-solid fa-people-group', 'aria-hidden': 'true' }), 'Nouvelle équipe'),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => $('#file-xlsx').click() }, h('i', { class: 'fa-solid fa-file-import', 'aria-hidden': 'true' }), 'Importer Excel'),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: exporterObjectifs }, h('i', { class: 'fa-solid fa-file-export', 'aria-hidden': 'true' }), 'Exporter Excel'));
    const carte = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Objectifs — ' + CT.date.libelleMois(cle)), h('p', {}, 'Double-clic sur une cellule pour la modifier. Équipe → logins × B2C / B2B ; jour et semaine : valeurs du fichier (modifiables) ou calculées selon le mode choisi plus haut.'))), outils, h('div', { id: 'obj-table' }));
    root.replaceChildren(carteCal, carte); rendreTableObj();
  }
  function rendreTableObj() {
    const o = P().objectifs, q = filtre.toLowerCase(), tb = h('tbody'), mc = CT.objectifs.modeCalcul(o), tot = { b2c: 0, b2b: 0, mois: 0 };
    o.equipes.forEach((eq) => {
      const ff = !mc && eq.fichier && eq.fichier.mois != null ? eq.fichier : null;
      const c = CT.somme(eq.logins, (l) => +l.b2c || 0), b = CT.somme(eq.logins, (l) => +l.b2b || 0);
      tot.b2c += ff && ff.b2c != null ? ff.b2c : c; tot.b2b += ff && ff.b2b != null ? ff.b2b : b; tot.mois += ff ? ff.mois : c + b;
    });
    o.equipes.forEach((eq, ei) => {
      const logins = eq.logins.map((l, li) => ({ l, li })).filter((x) => !q || x.l.login.toLowerCase().includes(q) || eq.id.toLowerCase().includes(q));
      if (q && !logins.length) return;
      const ff = !mc && eq.fichier && eq.fichier.mois != null ? eq.fichier : null;
      const sb2c = ff && ff.b2c != null ? ff.b2c : CT.somme(eq.logins, (l) => +l.b2c || 0), sb2b = ff && ff.b2b != null ? ff.b2b : CT.somme(eq.logins, (l) => +l.b2b || 0), sm = ff ? ff.mois : sb2c + sb2b;
      tb.append(h('tr', { class: 'row-sub' },
        cellule({ val: eq.id, label: 'Nom de l\'équipe', onCommit: (v) => { if (o.equipes.some((x, i) => i !== ei && x.id === v)) { CT.toast('Nom d\'équipe déjà utilisé.', 'warn'); return; } eq.id = v; enregistrer(); rendreTableObj(); } }),
        cellule({ val: eq.superviseur || '', fmt: (v) => v || '— superviseur', label: 'Superviseur', onCommit: (v) => { eq.superviseur = v; enregistrer(); rendreTableObj(); } }),
        h('td', { class: 'num' }, CT.fmt.int(sb2c)), h('td', { class: 'num' }, CT.fmt.int(sb2b)), h('td', { class: 'num' }, CT.fmt.int(sm)), mc ? h('td', { class: 'num' }, CT.fmt.int(CT.objectifs.jourEq(eq, o))) : cellule({ val: CT.objectifs.jourEq(eq, o), num: true, fmt: CT.fmt.int, label: 'Objectif jour de ' + eq.id, onCommit: (v) => { eq.jour = Math.round(v); enregistrer(); rendreTableObj(); } }), mc ? h('td', { class: 'num' }, CT.fmt.int(CT.objectifs.semEq(eq, o))) : cellule({ val: CT.objectifs.semEq(eq, o), num: true, fmt: CT.fmt.int, label: 'Objectif semaine de ' + eq.id, onCommit: (v) => { eq.semaine = Math.round(v); enregistrer(); rendreTableObj(); } }),
        cellule({ val: Math.round((eq.part_rgz || 0) * 100), num: true, fmt: (v) => v + ' % RGZ', label: 'Part RGZ de la commission (%)', onCommit: (v) => { eq.part_rgz = Math.min(100, v) / 100; enregistrer(); rendreTableObj(); } }),
        h('td', {}, bouton('fa-trash', 'Supprimer l\'équipe ' + eq.id, async () => { if (await CT.confirmer('Supprimer l\'équipe', 'Supprimer « ' + eq.id + ' » et ses ' + eq.logins.length + ' login(s) ?', 'Supprimer', true)) { o.equipes.splice(ei, 1); enregistrer(); rendreTableObj(); } }))));
      logins.forEach(({ l, li }) => {
        const m = (+l.b2c || 0) + (+l.b2b || 0);
        const chk = h('input', { type: 'checkbox', checked: l.primes !== false && m > 0, 'aria-label': 'Éligible aux primes : ' + l.login, onchange: (e) => { l.primes = e.target.checked; enregistrer(); } });
        tb.append(h('tr', {},
          cellule({ val: l.login, label: 'Login', onCommit: (v) => { l.login = v; enregistrer(); rendreTableObj(); } }), h('td', { class: 'muted' }, ''),
          cellule({ val: +l.b2c || 0, num: true, label: 'Objectif B2C de ' + l.login, onCommit: (v) => { l.b2c = Math.round(v); delete l.mois; delete eq.fichier; if (l.primes === false && (+l.b2c || 0) + (+l.b2b || 0) > 0) l.primes = true; enregistrer(); rendreTableObj(); } }),
          cellule({ val: +l.b2b || 0, num: true, label: 'Objectif B2B de ' + l.login, onCommit: (v) => { l.b2b = Math.round(v); delete l.mois; delete eq.fichier; enregistrer(); rendreTableObj(); } }),
          h('td', { class: 'num' }, CT.fmt.int(!mc && l.mois != null ? l.mois : m)),
          mc ? h('td', { class: 'num' }, CT.fmt.int(CT.objectifs.jourLogin(l, o))) : cellule({ val: +l.jour || 0, num: true, fmt: CT.fmt.int, label: 'Objectif jour de ' + l.login, onCommit: (v) => { l.jour = Math.round(v); enregistrer(); rendreTableObj(); } }),
          mc ? h('td', { class: 'num' }, CT.fmt.int(CT.objectifs.semLogin(l, o))) : cellule({ val: +l.semaine || 0, num: true, fmt: CT.fmt.int, label: 'Objectif semaine de ' + l.login, onCommit: (v) => { l.semaine = Math.round(v); enregistrer(); rendreTableObj(); } }),
          h('td', {}, h('label', { class: 'check' }, chk, 'Primes')), h('td', {}, bouton('fa-xmark', 'Supprimer ' + l.login, () => { eq.logins.splice(li, 1); enregistrer(); rendreTableObj(); }))));
      });
    });
    const t = Object.assign(CT.objectifs.totaux(o), tot);
    const table = h('table', { class: 'data' }, h('caption', { class: 'sr-only' }, 'Objectifs du mois'),
      entete([{ t: 'Équipe / Login' }, { t: 'Superviseur' }, { t: 'Obj. B2C', num: 1 }, { t: 'Obj. B2B', num: 1 }, { t: 'Obj. mois', num: 1 }, { t: 'Obj. jour', num: 1 }, { t: 'Obj. semaine', num: 1 }, { t: 'Primes / part RGZ' }, { t: 'Actions' }]), tb,
      h('tfoot', {}, h('tr', {}, h('td', {}, 'TOTAL'), h('td'), h('td', { class: 'num' }, CT.fmt.int(t.b2c)), h('td', { class: 'num' }, CT.fmt.int(t.b2b)), h('td', { class: 'num' }, CT.fmt.int(t.mois)), h('td', { class: 'num' }, CT.fmt.int(t.jour)), h('td', { class: 'num' }, CT.fmt.int(t.semaine)), h('td'), h('td'))));
    $('#obj-table').replaceChildren(h('div', { class: 'table-wrap' }, table));
  }
  function exporterObjectifs() {
    const ws = XLSX.utils.aoa_to_sheet(CT.objectifs.versExcel(P().objectifs)); ws['!cols'] = [14, 32, 10, 10, 10, 10, 12, 8, 10].map((w) => ({ wch: w })); CT.styleEntete(ws);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Objectifs');
    CT.telecharger(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }), 'Objectifs_' + cle + '.xlsx'); CT.toast('Objectifs exportés.', 'ok', 3000);
  }
  /* Import des objectifs : le serveur lit le fichier, compare au mois en base puis répond
       identique → rien à faire · confirmation_requise → alerte + demande de confirmation · cree → écrit directement. */
  async function importerExcel(file) {
    try {
      if (onglet === 'regles') return importerRegles(XLSX.read(await file.arrayBuffer(), { type: 'array' }));
      await CT.store.flush();                       // le mois doit exister en base avant d'y importer
      const r = await CT.api.objectifs.importer(file, cle, false);
      await traiterImportObjectifs(r);
    } catch (err) { CT.toast(err.status === 409 || err.status === 410 || err.status === 422 ? err.message : 'Import impossible : ' + err.message, 'err', 8000); }
  }
  async function traiterImportObjectifs(r) {
    const mois = CT.date.libelleMois(cle);
    if (r.statut === 'identique') { CT.toast('Objectifs identiques à ceux déjà enregistrés pour ' + mois + ' : aucune mise à jour nécessaire.', 'info', 5000); return; }
    if (r.statut === 'confirmation_requise') {
      const d = r.diff.resume;
      const ex = r.diff.modifies.slice(0, 4).map((m) => m.libelle + ' (' + Object.entries(m.champs).map(([c, v]) => c + ' ' + v.avant + ' → ' + v.apres).join(', ') + ')').join(' ; ');
      const msg = 'Des objectifs existent déjà pour ' + mois + '. Différences détectées : ' + d.modifies + ' modifié(s), ' + d.ajoutes + ' ajouté(s), ' + d.supprimes + ' supprimé(s), ' + d.inchanges + ' inchangé(s).'
        + (ex ? ' Exemples : ' + ex + '.' : '') + ' Mettre à jour les enregistrements existants ? (Superviseurs et segments saisis à la main sont conservés.)';
      if (!(await CT.confirmer('Mettre à jour les objectifs', msg, 'Mettre à jour'))) { CT.toast('Mise à jour annulée : rien n\'a été modifié.', 'info', 4000); return; }
      r = await CT.api.objectifs.confirmer(r.token);
    }
    await CT.store.recharger(); rendreObjectifs();
    CT.toast('Objectifs de ' + mois + ' enregistrés en base.', 'ok');
  }

  /* ============================== RÈGLES ============================== */
  const lire = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const ecrire = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[l] = v; };
  function rendreRegles() {
    const root = $('#p-regles'), R = P().regles, O = P().objectifs;
    const champ = (id, label, ou, chemin, o = {}) => {
      const pct = o.pct, brut = lire(ou, chemin), val = pct ? Math.round((brut || 0) * 100) : brut;
      return h('div', { class: 'field' }, h('label', { for: 'r-' + id }, label), h('input', { class: 'input', id: 'r-' + id, type: o.texte ? 'text' : 'number', min: '0', step: 'any', value: o.texte && Array.isArray(brut) ? brut.join(', ') : val == null ? '' : val,
        onchange: (e) => { let v = o.texte ? e.target.value : Math.max(0, nombre(e.target.value)); if (o.texte && o.liste) v = v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean); if (pct) v = v / 100; ecrire(ou, chemin, v); enregistrer(); } }), o.aide ? h('span', { class: 'hint' }, o.aide) : null);
    };
    const paliers = (titre, chemin) => {
      const liste = lire(R, chemin), tb = h('tbody');
      liste.forEach((p, i) => tb.append(h('tr', {}, cellule({ val: p.nom, label: 'Nom du palier', onCommit: (v) => { p.nom = v; enregistrer(); rendreRegles(); } }),
        cellule({ val: Math.round(p.seuil * 100), num: true, fmt: (v) => v + ' %', label: 'Seuil de TRO', onCommit: (v) => { p.seuil = v / 100; liste.sort((a, b) => a.seuil - b.seuil); enregistrer(); rendreRegles(); } }),
        cellule({ val: p.prime, num: true, fmt: CT.fmt.fcfa, label: 'Prime', onCommit: (v) => { p.prime = v; enregistrer(); rendreRegles(); } }),
        h('td', {}, bouton('fa-xmark', 'Supprimer le palier ' + p.nom, () => { liste.splice(i, 1); enregistrer(); rendreRegles(); })))));
      return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, titre), h('p', {}, 'Un palier s\'applique dès que le TRO atteint son seuil.')),
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => fenetreAjout('Nouveau palier — ' + titre, [{ t: 'Nom du palier', ph: 'ex. Or' }, { t: 'Seuil de TRO (%)', num: true, ph: 'ex. 100' }, { t: 'Prime (FCFA)', num: true, ph: 'ex. 25000' }], ([nom, seuil, prime]) => {
          if (!(seuil > 0)) return 'Le seuil de TRO doit être supérieur à 0 %.';
          if (liste.some((x) => Math.round(x.seuil * 100) === Math.round(seuil))) return 'Un palier existe déjà à ' + Math.round(seuil) + ' %.';
          liste.push({ nom, seuil: seuil / 100, prime }); liste.sort((a, b) => a.seuil - b.seuil); enregistrer(); rendreRegles();
          CT.toast('Palier « ' + nom + ' » ajouté.', 'ok', 3000);
        }) }, h('i', { class: 'fa-solid fa-plus', 'aria-hidden': 'true' }), 'Ajouter')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, entete([{ t: 'Palier' }, { t: 'Seuil TRO', num: 1 }, { t: 'Prime (FCFA)', num: 1 }, { t: '' }]), tb)));
    };
    const outils = h('div', { class: 'table-tools' },
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => $('#file-xlsx').click() }, h('i', { class: 'fa-solid fa-file-import', 'aria-hidden': 'true' }), 'Importer Excel'),
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: exporterRegles }, h('i', { class: 'fa-solid fa-file-export', 'aria-hidden': 'true' }), 'Exporter Excel'));
    root.replaceChildren(outils,
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Primes agents — ' + CT.date.libelleMois(cle)))),
          h('div', { class: 'form-grid' }, champ('jr', 'Journée réussie (FCFA)', R, 'agent.journee_reussie'), champ('champ', 'Champion du jour (FCFA)', R, 'agent.champion_du_jour.prime'), champ('b2b', 'Bonus objectif B2B atteint (FCFA)', R, 'agent.bonus_b2b'))),
        paliers('Paliers agents (TRO du mois)', 'agent.paliers_tro'),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Primes superviseurs et équipes'))),
          h('div', { class: 'form-grid' }, champ('je', 'Journée équipe réussie (FCFA)', R, 'superviseur.journee_equipe'), champ('sa', 'Activation : seuil agent (% de son objectif)', R, 'superviseur.activation.seuil_agent', { pct: true }),
            champ('ta', 'Activation : part minimale d\'agents actifs (%)', R, 'superviseur.activation.taux_min', { pct: true }), champ('te', 'Trophée équipe : enveloppe (FCFA)', R, 'superviseur.trophee.enveloppe'), champ('tt', 'Trophée : TRO minimal (%)', R, 'superviseur.trophee.tro_min', { pct: true }))),
        paliers('Paliers superviseurs (TRO équipe)', 'superviseur.paliers_tro'),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Comptage des ventes'), h('p', {}, 'Conforme aux fichiers : seules les ventes « OK » comptent ; « VALIDE » = en attente.'))),
          h('div', { class: 'form-grid' }, champ('st', 'Statuts comptés (séparés par une virgule)', R, 'statuts_comptes', { texte: true, liste: true }), champ('sb', 'B2B = TYPE_CLIENT égal à', R, 'segment_b2b.valeur', { texte: true }),
            champ('sx', 'Seuil de montant atypique (FCFA)', R, 'seuil_montant_atypique', { aide: 'Au-delà, la ligne est exclue du CA (sauf case cochée au dashboard).' })),
          h('div', { class: 'field' }, h('label', { for: 'oc' }, 'Offres comptées (NOM_OFFRE, une par ligne)'),
            h('textarea', { class: 'input', id: 'oc', rows: '5',
              onchange: (e) => { R.offres_comptees = [...new Set(e.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))]; enregistrer(); rendreRegles(); } }, CT.regles.offresComptees(R).join('\n')),
            h('span', { class: 'hint' }, 'Seules ces offres entrent dans les calculs (primes, performance, exports) ; les autres lignes restent en base mais sont ignorées. Casse, accents et espaces ignorés. Liste vide = toutes les offres.'))),
        h('p', { class: 'hint' }, 'Les commissions one-shot (B2C / B2B) et la part RGZ se règlent dans l\'onglet Objectifs.')));
  }
  function exporterRegles() {
    const R = P().regles, wb = XLSX.utils.book_new();
    const sc = [['Clé', 'Valeur'], ['agent.journee_reussie', R.agent.journee_reussie], ['agent.champion_du_jour.prime', R.agent.champion_du_jour.prime], ['agent.bonus_b2b', R.agent.bonus_b2b], ['superviseur.journee_equipe', R.superviseur.journee_equipe],
      ['superviseur.activation.seuil_agent', R.superviseur.activation.seuil_agent], ['superviseur.activation.taux_min', R.superviseur.activation.taux_min], ['superviseur.trophee.enveloppe', R.superviseur.trophee.enveloppe], ['superviseur.trophee.tro_min', R.superviseur.trophee.tro_min],
      ['seuil_montant_atypique', R.seuil_montant_atypique], ['statuts_comptes', (R.statuts_comptes || []).join(', ')], ['offres_comptees', CT.regles.offresComptees(R).join(' | ')], ['segment_b2b.valeur', (R.segment_b2b || {}).valeur]];
    const add = (nom, aoa, cols) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = cols.map((w) => ({ wch: w })); CT.styleEntete(ws); XLSX.utils.book_append_sheet(wb, ws, nom); };
    add('Paramètres', sc, [38, 20]);
    add('Paliers agents', [['Palier', 'Seuil TRO', 'Prime']].concat(R.agent.paliers_tro.map((p) => [p.nom, p.seuil, p.prime])), [18, 12, 12]);
    add('Paliers superviseurs', [['Palier', 'Seuil TRO', 'Prime']].concat(R.superviseur.paliers_tro.map((p) => [p.nom, p.seuil, p.prime])), [18, 12, 12]);
    CT.telecharger(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }), 'Regles_motivation_' + cle + '.xlsx'); CT.toast('Règles exportées.', 'ok', 3000);
  }
  async function importerRegles(wb) {
    const R = P().regles, lig = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null }).slice(1).filter((r) => r[0] != null) : null);
    const sc = lig('Paramètres'), pa = lig('Paliers agents'), ps = lig('Paliers superviseurs');
    if (!sc && !pa && !ps) { CT.toast('Feuilles « Paramètres », « Paliers agents » ou « Paliers superviseurs » introuvables : utilisez le modèle exporté.', 'err', 8000); return; }
    if (!(await CT.confirmer('Importer les règles', 'Remplacer les règles de ' + CT.date.libelleMois(cle) + ' par celles du fichier ?', 'Remplacer'))) return;
    (sc || []).forEach(([k, v]) => { if (k === 'offres_comptees') ecrire(R, k, [...new Set(String(v == null ? '' : v).split(/\s*[|\r\n]+\s*/).map((x) => x.trim()).filter(Boolean))]); else if (k === 'statuts_comptes') ecrire(R, k, String(v).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)); else if (k === 'segment_b2b.valeur') ecrire(R, k, String(v)); else if (lire(R, k) !== undefined) ecrire(R, k, nombre(v)); });
    if (pa) R.agent.paliers_tro = pa.map((r) => ({ nom: String(r[0]), seuil: nombre(r[1]), prime: nombre(r[2]) })).sort((a, b) => a.seuil - b.seuil);
    if (ps) R.superviseur.paliers_tro = ps.map((r) => ({ nom: String(r[0]), seuil: nombre(r[1]), prime: nombre(r[2]) })).sort((a, b) => a.seuil - b.seuil);
    enregistrer(); rendreRegles(); CT.toast('Règles importées.', 'ok');
  }

  /* ============================== PARTENAIRES ============================== */
  function rendrePartenaires() {
    const root = $('#p-part'), C = CT.store.get().partenaires;
    const tableSimple = (titre, aide, liste, cols, ajouter, supprimer) => {
      // Colonne « auto » : valeur calculée par le serveur (ex. historique des mois présents en base), affichée mais non modifiable
      const lecture = (c, x) => h('td', { class: 'num cell-auto', title: 'Calculé automatiquement à partir des ventes en base (non modifiable)' }, String(c.get(x)));
      const tb = h('tbody'); liste.forEach((x, i) => tb.append(h('tr', {}, cols.map((c) => c.auto ? lecture(c, x) : cellule({ val: c.get(x), label: c.t, onCommit: (v) => { if (c.valide && !c.valide(v)) { CT.toast('Valeur invalide pour « ' + c.t + ' ».', 'warn'); return; } c.set(x, v); enregistrer(); rendrePartenaires(); } })), h('td', {}, bouton('fa-xmark', 'Supprimer la ligne', () => { supprimer(i); enregistrer(); rendrePartenaires(); })))));
      return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, titre), h('p', {}, aide)), h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => {
        const modif = cols.filter((c) => !c.auto);
        fenetreAjout('Ajouter — ' + titre, modif.map((c) => ({ t: c.t, num: c.num, ph: c.ph })), (vals) => {
          const bad = modif.findIndex((c, i) => c.valide && !c.valide(String(vals[i])));
          if (bad >= 0) return 'Valeur invalide pour « ' + modif[bad].t + ' ».';
          const err = ajouter(vals); if (err) return err;
          enregistrer(); rendrePartenaires(); CT.toast('Ligne ajoutée.', 'ok', 3000);
        });
      } }, h('i', { class: 'fa-solid fa-plus', 'aria-hidden': 'true' }), 'Ajouter')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, entete(cols.map((c) => ({ t: c.t, auto: c.auto })).concat([{ t: '' }])), tb)));
    };
    C.remplacements_login = C.remplacements_login || [];
    const nominatif = Object.entries(C.logins_partenaire || {}).flatMap(([p, ls]) => (ls || []).map((l) => ({ l, p })));
    const syncNominatif = () => {
      const o = {}; nominatif.forEach((x) => { const p = String(x.p).trim().toUpperCase(); if (x.l && p) (o[p] = o[p] || []).push(x.l); });
      C.logins_partenaire = o;
    };
    const anneeCourante = new Date().getFullYear();
    const histo = C.historique || { annee: anneeCourante, mois: [], partenaires: {} };
    // Mettre à jour l'année automatiquement si elle est différente
    if (histo.annee !== anneeCourante) {
      histo.annee = anneeCourante;
      enregistrer();
    }
    const hl = Object.entries(histo.partenaires).map(([n, v]) => ({ n, v }));
    const histoSync = () => { histo.partenaires = Object.fromEntries(hl.map((x) => [x.n.toUpperCase(), x.v])); };
    root.replaceChildren(h('div', { class: 'stack' },
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Partenaire prioritaire'), h('p', {}, 'Mis en avant partout (tableaux, cartes, objectifs, plan de motivation). Paramètres communs à tous les mois.'))),
        h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', { for: 'pp' }, 'Partenaire prioritaire'), h('input', { class: 'input', id: 'pp', value: C.prioritaire, onchange: (e) => { C.prioritaire = e.target.value.trim().toUpperCase() || 'RGZ'; enregistrer(); } })),
          h('div', { class: 'field' }, h('label', { for: 'pd' }, 'Partenaire par défaut (logins non reconnus)'), h('input', { class: 'input', id: 'pd', value: C.defaut, onchange: (e) => { C.defaut = e.target.value.trim().toUpperCase() || 'AUTRES'; enregistrer(); } })))),
      tableSimple('Remplacements de login → partenaire', 'Si le LOGIN_VENDEUR contient le motif (casse ignorée), la vente va au partenaire. Testés dans l\'ordre du tableau, après la liste nominative : le premier motif trouvé l\'emporte. Login reconnu par aucune ligne : agence (ci-dessous), sinon partenaire par défaut.', C.remplacements_login,
        [{ t: 'Le login contient', ph: 'ex. rgz', get: (x) => x.motif, set: (x, v) => { x.motif = v.trim().toLowerCase(); }, valide: (v) => !!String(v).trim() }, { t: 'Partenaire', ph: 'ex. RGZ', get: (x) => x.partenaire, set: (x, v) => { x.partenaire = v.trim().toUpperCase(); }, valide: (v) => !!String(v).trim() }],
        ([m, p]) => { const motif = String(m).trim().toLowerCase(); const d = C.remplacements_login.find((r) => r.motif === motif); if (d) return 'Le motif « ' + motif + ' » est déjà associé à ' + d.partenaire + '.'; C.remplacements_login.push({ motif, partenaire: String(p).trim().toUpperCase() }); }, (i) => C.remplacements_login.splice(i, 1)),
      tableSimple('Logins sans préfixe → partenaire', 'Liste nominative (ex. vendeurs POP&SHOP), testée en premier. Casse, « - »/« _ » et « .ftth » final ignorés. Les nouveaux vendeurs non listés d\'une agence POP / Celtiis Shop sont signalés à l\'import.', nominatif,
        [{ t: 'Login', ph: 'ex. cgaba', get: (x) => x.l, set: (x, v) => { x.l = v.trim(); syncNominatif(); } }, { t: 'Partenaire', ph: 'ex. POP&SHOP', get: (x) => x.p, set: (x, v) => { x.p = v; syncNominatif(); } }],
        ([l, p]) => { const d = nominatif.find((x) => CT.cleLogin(x.l) === CT.cleLogin(l)); if (d) return 'Le login « ' + l + ' » est déjà associé à ' + d.p + '.'; nominatif.push({ l: String(l).trim(), p }); syncNominatif(); }, (i) => { nominatif.splice(i, 1); syncNominatif(); }),
      tableSimple('Agences → partenaire', 'Seulement pour les logins reconnus ni par la liste nominative ni par les remplacements : le motif (expression régulière, insensible à la casse) est testé sur l\'AGENCE, dans l\'ordre.', C.regles_agence,
        [{ t: 'Motif (regex)', ph: 'ex. cotonou|akpakpa', get: (x) => x.motif, set: (x, v) => { x.motif = v; }, valide: (v) => { try { new RegExp(v); return true; } catch (e) { return false; } } }, { t: 'Partenaire', ph: 'ex. RGZ', get: (x) => x.partenaire, set: (x, v) => { x.partenaire = v.toUpperCase(); } }],
        ([motif, p]) => { C.regles_agence.push({ motif, partenaire: p.toUpperCase() }); }, (i) => C.regles_agence.splice(i, 1)),
      tableSimple('Historique mensuel ' + histo.annee + ' (ventes par partenaire)', 'Alimente la colonne « mois précédent », l\'évolution et les graphiques de Performance partenaire. '
        + ((histo.auto || []).some(Boolean) ? 'Colonnes grisées (⟳) : calculées automatiquement à partir des ventes en base, mises à jour à chaque import. Les autres mois (sans données en base) se saisissent à la main.' : 'Les mois se rempliront automatiquement dès que leurs ventes seront importées.'), hl,
        [{ t: 'Partenaire', ph: 'ex. RGZ', get: (x) => x.n, set: (x, v) => { x.n = v; histoSync(); } }].concat(histo.mois.map((m, i) => ({ t: (histo.auto || [])[i] ? m + ' ⟳' : m, auto: !!(histo.auto || [])[i], num: true, ph: '0', get: (x) => x.v[i] == null ? 0 : x.v[i], set: (x, v) => { x.v[i] = nombre(v); histoSync(); }, valide: (v) => isFinite(parseFloat(v)) }))),
        ([nom, ...ventes]) => {   // ventes : mois saisis à la main seulement (les mois ⟳ sont calculés par le serveur)
          const n = nom.toUpperCase(); if (hl.some((x) => x.n.toUpperCase() === n)) return 'Le partenaire « ' + n + ' » est déjà dans l\'historique.';
          let j = 0; hl.push({ n, v: histo.mois.map((m, i) => ((histo.auto || [])[i] ? 0 : ventes[j++])) }); histoSync();
        }, (i) => { hl.splice(i, 1); histoSync(); })));
  }

  /* ============================== SAUVEGARDE ============================== */
  function rendreSauvegarde() {
    const st = CT.store.get(), taille = new Blob([JSON.stringify(st)]).size;
    const carte = (l, v) => h('div', { class: 'kpi' }, h('div', {}, h('div', { class: 'kpi-label' }, l), h('div', { class: 'kpi-value', style: 'font-size:var(--fs-20)' }, v)));
    $('#p-save').replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'grid-kpi' }, carte('Dernière modification', st.modifie ? new Date(st.modifie).toLocaleString('fr-FR') : 'Valeurs par défaut (jamais modifié)'), carte('Mois paramétrés', CT.store.cles().map((k) => CT.date.libelleMois(k)).join(', ')), carte('Taille', CT.fmt.octets(taille))),
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Export / import JSON'), h('p', {}, 'Sauvegarde complète : tous les mois (objectifs + règles), partenaires et historique. Utile pour changer de poste ou de navigateur.'))),
        h('div', { class: 'pill-row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { CT.telecharger(new Blob([CT.store.exporterJSON()], { type: 'application/json' }), 'parametres_calculateur_' + new Date().toISOString().slice(0, 10) + '.json'); CT.toast('Sauvegarde JSON téléchargée.', 'ok', 3000); } }, h('i', { class: 'fa-solid fa-download', 'aria-hidden': 'true' }), 'Exporter le JSON complet'),
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => $('#file-json').click() }, h('i', { class: 'fa-solid fa-upload', 'aria-hidden': 'true' }), 'Importer un JSON'))),
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Réinitialisation'), h('p', {}, 'Retour aux valeurs d\'origine (objectifs et règles d\'octobre 2026). Tous vos mois et partenaires personnalisés seront perdus.'))),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (await CT.confirmer('Tout réinitialiser ?', 'Cette action supprime tous les paramètres enregistrés dans ce navigateur. Exportez d\'abord un JSON si besoin.', 'Réinitialiser', true)) { CT.store.reinitialiser(); cle = CT.store.cles().pop(); mettreAJourUrl(); rendreTout(); CT.toast('Paramètres réinitialisés.', 'ok'); } } }, h('i', { class: 'fa-solid fa-triangle-exclamation', 'aria-hidden': 'true' }), 'Tout réinitialiser'))));
  }

  /* ============================== Barre de période + onglets ============================== */
  function rendrePeriode() {
    const sel = $('#sel-periode'); sel.replaceChildren(...CT.store.cles().map((k) => h('option', { value: k, selected: k === cle }, CT.date.libelleMois(k))));
    $('#btn-reset-periode').disabled = !(CT.DEFAUTS.objectifs.periode === cle);
    $('#btn-suppr-mois').disabled = CT.store.cles().length <= 1;
  }
  function rendreTout() {
    rendrePeriode();
    ({ obj: rendreObjectifs, regles: rendreRegles, part: rendrePartenaires, save: rendreSauvegarde })[onglet]();
  }
  function choisirOnglet(o) {
    onglet = o;
    $$('#tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.id === 'tab-' + o)));
    ['obj', 'regles', 'part', 'save'].forEach((x) => { $('#p-' + x).hidden = x !== o; });
    $('#periode-bar').hidden = !(o === 'obj' || o === 'regles');
    rendreTout();
    if (o === 'part') actualiserHistorique();
  }
  /* Historique mensuel : relu sur le serveur (ventes en base) à l'ouverture de l'onglet et au retour sur la page — un import
     fait entre-temps dans le tableau de bord apparaît sans recharger */
  async function actualiserHistorique() {
    try { if (await CT.store.rafraichirHistorique() && onglet === 'part') rendrePartenaires(); } catch (e) { /* hors ligne : on garde l'affichage */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && onglet === 'part') actualiserHistorique(); });

  function mettreAJourUrl() {
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('periode', cle);
    window.history.replaceState({}, '', newUrl);
    // Mémorisation dans le sessionStorage pour éviter la réinitialisation intempestive
    sessionStorage.setItem('derniere_periode', cle);
  }

  function init() {
    // Récupérer la période depuis l'URL, ou le sessionStorage, ou utiliser le dernier mois
    const urlParams = new URLSearchParams(window.location.search);
    const periodeUrl = urlParams.get('periode');
    const periodeSession = sessionStorage.getItem('derniere_periode');
    const cles = CT.store.cles();
    
    cle = (periodeUrl && cles.includes(periodeUrl)) ? periodeUrl 
        : (periodeSession && cles.includes(periodeSession)) ? periodeSession 
        : cles.pop();
        
    mettreAJourUrl();

    $('#sel-periode').addEventListener('change', (e) => {
      cle = e.target.value;
      filtre = '';
      sessionStorage.setItem('derniere_periode', cle);
      mettreAJourUrl();
      rendreTout();
    });
    $$('#tabs [role=tab]').forEach((b) => b.addEventListener('click', () => choisirOnglet(b.id.replace('tab-', ''))));
    $('#tabs').addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; const t = $$('#tabs [role=tab]'), i = t.findIndex((x) => x.getAttribute('aria-selected') === 'true'); const n = t[(i + (e.key === 'ArrowRight' ? 1 : t.length - 1)) % t.length]; n.focus(); n.click(); });
    // Menu mobile
    const btn = $('#mobile-menu-btn');
    const nav = $('.nav-tabs');
    const overlay = $('#mobile-overlay');
    if (btn && nav) {
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
      nav.querySelectorAll('a, button').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (el.tagName === 'A' && el.href) {
            closeMenu();
          } else {
            setTimeout(closeMenu, 100);
          }
        });
      });
    }
    $('#btn-nouveau-mois').addEventListener('click', async () => {
      const ks = CT.store.cles(), defaut = CT.date.moisSuivant(ks[ks.length - 1]);
      const inp = h('input', { class: 'input', type: 'month', id: 'nm', value: defaut, 'aria-label': 'Mois à créer' });
      const ok = await CT.modal({ titre: 'Nouveau mois', corps: h('div', {}, h('p', { class: 'muted', style: 'margin-bottom:12px' }, 'Les objectifs et règles du mois précédent sont dupliqués (calendrier lundi → vendredi).'), inp), actions: [{ label: 'Annuler', valeur: false }, { label: 'Créer', valeur: true, variante: 'primary' }] });
      if (!ok) return; const k = inp.value;
      if (!/^\d{4}-\d{2}$/.test(k)) { CT.toast('Mois invalide.', 'err'); return; }
      if (CT.store.get().periodes[k]) { CT.toast(CT.date.libelleMois(k) + ' existe déjà.', 'warn'); cle = k; mettreAJourUrl(); rendreTout(); return; }
      CT.store.creerPeriode(k, ks.filter((x) => x < k).pop() || cle); cle = k; mettreAJourUrl(); rendreTout(); CT.toast(CT.date.libelleMois(k) + ' créé à partir du mois précédent.', 'ok');
    });
    $('#btn-dup-annee').addEventListener('click', async () => {
      const y = +cle.slice(0, 4);
      if (!(await CT.confirmer('Dupliquer l\'année', 'Créer les 12 mois de ' + (y + 1) + ' (les mois déjà existants sont conservés), à partir des mois ' + y + ' ou, à défaut, de ' + CT.date.libelleMois(cle) + ' ?', 'Dupliquer'))) return;
      let n = 0; for (let m = 1; m <= 12; m++) { const mm = String(m).padStart(2, '0'), k = (y + 1) + '-' + mm; if (CT.store.get().periodes[k]) continue; CT.store.creerPeriode(k, CT.store.get().periodes[y + '-' + mm] ? y + '-' + mm : cle); n++; }
      rendreTout(); CT.toast(n + ' mois créé(s) pour ' + (y + 1) + '.', 'ok');
    });
    $('#btn-reset-periode').addEventListener('click', async () => {
      if (!(await CT.confirmer('Réinitialiser ' + CT.date.libelleMois(cle), 'Remettre les objectifs ET les règles de ce mois aux valeurs d\'origine ?', 'Réinitialiser', true))) return;
      CT.store.get().periodes[cle] = { objectifs: CT.clone(CT.DEFAUTS.objectifs), regles: CT.clone(CT.DEFAUTS.regles) }; CT.store.sauver('reset-mois'); rendreTout(); CT.toast('Mois réinitialisé.', 'ok');
    });
    $('#btn-suppr-mois').addEventListener('click', async () => {
      const ks = CT.store.cles();
      if (ks.length <= 1) {
        CT.toast('Impossible de supprimer : il faut au moins un mois.', 'warn', 3000);
        return;
      }
      if (!(await CT.confirmer('Supprimer ' + CT.date.libelleMois(cle), 'Supprimer définitivement ce mois et tous ses objectifs et règles ? Cette action est irréversible.', 'Supprimer', true))) return;
      delete CT.store.get().periodes[cle];
      CT.store.sauver('delete-mois');
      cle = CT.store.cles().pop();
      mettreAJourUrl();
      rendreTout();
      CT.toast(CT.date.libelleMois(cle) + ' supprimé.', 'ok');
    });
    $('#file-xlsx').addEventListener('change', (e) => { if (e.target.files[0]) importerExcel(e.target.files[0]); e.target.value = ''; });
    $('#file-json').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const r = CT.store.importerJSON(await f.text());
      if (r.ok) { cle = CT.store.cles().pop(); mettreAJourUrl(); rendreTout(); CT.toast('Paramètres importés.', 'ok'); }
      else CT.modal({ titre: 'Import refusé', corps: '<ul>' + r.erreurs.map((x) => '<li>' + CT.esc(x) + '</li>').join('') + '</ul>' });
    });
    // Thème (partagé avec la page principale)
    const T = ['auto', 'light', 'dark'], I = { auto: 'fa-circle-half-stroke', light: 'fa-sun', dark: 'fa-moon' };
    const ap = (t) => { document.documentElement.setAttribute('data-theme', t); $('#theme-btn').innerHTML = '<i class="fa-solid ' + I[t] + '" aria-hidden="true"></i><span class="sr-only">Thème : ' + t + '</span>'; };
    ap('auto');
    $('#theme-btn').addEventListener('click', () => ap(T[(T.indexOf(document.documentElement.getAttribute('data-theme')) + 1) % 3]));
    window.addEventListener('scroll', () => $('.app-header').classList.toggle('is-scrolled', window.scrollY > 4), { passive: true });
    // Restaurer l'onglet sauvegardé au démarrage
    choisirOnglet(onglet);
  }
  const demarrer = () => CT.store.pret.then(init);   // paramètres chargés depuis la base avant l'affichage
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();