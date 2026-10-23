/* ============================================================================
   utils.js — fonctions utilitaires partagées (formats, dates, DOM, toasts, modales)
   Tout est exposé sous l'espace de noms global CT.
   ========================================================================== */
(function () {
  'use strict';
  const CT = (window.CT = window.CT || {});

  /* ---------- Formats numériques (locale fr-FR) ---------- */
  const nfInt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const nfDec = (d) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const nfNat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const nbsp = (s) => String(s).replace(/[\u202f\u00a0]/g, '\u00a0');
  CT.fmt = {
    int: (n) => (n == null || isNaN(n) ? '—' : nbsp(nfInt.format(Math.round(n)))),
    nat: (n) => (n == null || isNaN(n) ? '—' : nbsp(nfNat.format(n))),   // valeur telle quelle (jusqu'à 2 décimales), sans arrondi à l'entier
    dec: (n, d = 1) => (n == null || isNaN(n) ? '—' : nbsp(nfDec(d).format(n))),
    fcfa: (n) => (n == null || isNaN(n) ? '—' : nbsp(nfInt.format(Math.round(n))) + '\u00a0FCFA'),
    pct: (x, d = 0) => (x == null || !isFinite(x) ? '—' : nbsp(nfDec(d).format(x * 100)) + '\u00a0%'),
    // Variante « texte brut » (WhatsApp / e-mail) : espaces simples
    txt: (s) => String(s).replace(/[\u202f\u00a0]/g, ' '),
    // Montant sans unité (l'unité est portée par l'en-tête de colonne) : 0 reste « 0 », jamais vide
    mnt: (n) => (n == null || isNaN(n) ? '0' : nbsp(nfInt.format(Math.round(n)))),
    octets: (n) => (n < 1024 ? n + ' o' : n < 1048576 ? (n / 1024).toFixed(1) + ' Ko' : (n / 1048576).toFixed(1) + ' Mo'),
  };

  /* ---------- Dates : on manipule des jours « YYYY-MM-DD » en UTC ---------- */
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const p2 = (n) => String(n).padStart(2, '0');
  const D = {
    MOIS, JOURS,
    parse: (j) => new Date(Date.UTC(+j.slice(0, 4), +j.slice(5, 7) - 1, +j.slice(8, 10))),
    str: (d) => d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()),
    dow: (j) => D.parse(j).getUTCDay(), // 0 = dimanche
    ajouter: (j, n) => { const d = D.parse(j); d.setUTCDate(d.getUTCDate() + n); return D.str(d); },
    moisCle: (j) => j.slice(0, 7),
    long: (j) => JOURS[D.dow(j)] + ' ' + +j.slice(8, 10) + (j.slice(8, 10) === '01' ? 'er ' : ' ') + MOIS[+j.slice(5, 7) - 1] + ' ' + j.slice(0, 4),
    court: (j) => j.slice(8, 10) + '/' + j.slice(5, 7) + '/' + j.slice(0, 4),
    jourMois: (j) => +j.slice(8, 10) + ' ' + MOIS[+j.slice(5, 7) - 1],
    libelleMois: (cle) => MOIS[+cle.slice(5, 7) - 1].replace(/^./, (c) => c.toUpperCase()) + ' ' + cle.slice(0, 4),
    nbJours: (cle) => new Date(Date.UTC(+cle.slice(0, 4), +cle.slice(5, 7), 0)).getUTCDate(),
    joursDuMois: (cle) => Array.from({ length: D.nbJours(cle) }, (_, i) => cle + '-' + p2(i + 1)),
    // Lundi de la semaine contenant le jour j
    lundiDe: (j) => { const w = D.dow(j); return D.ajouter(j, w === 0 ? -6 : 1 - w); },
    // Calendrier par défaut d'un mois : lundi → vendredi
    ouvresDefaut: (cle) => D.joursDuMois(cle).filter((j) => { const w = D.dow(j); return w >= 1 && w <= 5; }).map((j) => +j.slice(8)),
    moisSuivant: (cle) => { let y = +cle.slice(0, 4), m = +cle.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + p2(m); },
    moisPrecedent: (cle) => { let y = +cle.slice(0, 4), m = +cle.slice(5, 7) - 1; if (m < 1) { m = 12; y--; } return y + '-' + p2(m); },
  };
  CT.date = D;

  /* ---------- Normalisation des logins ----------
     pvt-rgz-olouis.ftth  → pvt_rgz_olouis ; « pvt_rgz_amarcel » et « pvt_rgz_amarcel.ftth » → même clé */
  CT.cleLogin = (l) => String(l == null ? '' : l).trim().toLowerCase().replace(/-/g, '_').replace(/\.ftth$/, '');
  CT.loginCourt = (l) => CT.cleLogin(l).replace(/^(pvt|pms|stg)_[a-z0-9]+_/, '');

  /* ---------- DOM ---------- */
  CT.$ = (s, r = document) => r.querySelector(s);
  CT.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  CT.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CT.h = function (tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c != null && el.append(c.nodeType ? c : document.createTextNode(c)));
    return el;
  };
  CT.debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  CT.nextFrame = () => new Promise((r) => setTimeout(r, 0));

  /* ---------- Toasts ---------- */
  /* ---------- Icônes SVG épurées (trait 2 px, héritent de currentColor) ---------- */
  const ICONES = {
    alerte: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    succes: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    critique: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9Z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    action: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    ampoule: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.1 14c.2-1 .7-1.7 1.5-2.5A6 6 0 1 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    copier: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    crayon: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  };
  CT.icone = (nom, cls) => '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONES[nom] || ICONES.info) + '</svg>';

  /* html2canvas 1.4.1 ne comprend pas les couleurs CSS modernes : color-mix() (calculé par le navigateur en « color(srgb …) »),
     oklch(), lab()… et abandonne toute la capture (ex. ligne du champion surlignée). Dans la copie qu'il rend, chaque couleur
     de ce type est remplacée par son équivalent rgb(), obtenu en peignant un pixel : la couleur affichée est conservée. */
  const COULEUR_MODERNE = /(color\(|color-mix|oklch|oklab|lab\(|lch\()/i;
  const PROPS_COULEUR = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor'];
  function versRgb(valeur, ctx) {
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = valeur; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (a / 255).toFixed(3) + ')';
  }
  CT.couleursCompatibles = function (racine) {
    const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    const vue = racine.ownerDocument.defaultView;
    [racine, ...racine.querySelectorAll('*')].forEach((el) => {
      const cs = vue.getComputedStyle(el);
      PROPS_COULEUR.forEach((p) => { if (COULEUR_MODERNE.test(cs[p])) el.style[p] = versRgb(cs[p], ctx); });
      if (COULEUR_MODERNE.test(cs.boxShadow)) el.style.boxShadow = 'none';
      if (COULEUR_MODERNE.test(cs.backgroundImage)) el.style.backgroundImage = 'none';
    });
  };


  /* Valeur de carte KPI : l'unité monétaire passe en petit et peut aller à la ligne sans couper le nombre */
  CT.valeurKpi = (v) => String(v).replace(/\u00a0FCFA$/, ' <span class="unit">FCFA</span>');

  CT.toast = function (msg, type = 'info', ms = 5000) {
    let box = document.getElementById('toasts');
    if (!box) { box = CT.h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
    const ic = { ok: 'fa-circle-check', warn: 'fa-triangle-exclamation', err: 'fa-circle-xmark', info: 'fa-circle-info' }[type] || 'fa-circle-info';
    const t = CT.h('div', { class: 'toast ' + type, role: type === 'err' ? 'alert' : 'status' },
      CT.h('i', { class: 'fa-solid ' + ic, 'aria-hidden': 'true' }), CT.h('div', {}, msg));
    box.append(t);
    setTimeout(() => t.remove(), ms);
  };

  /* ---------- Modale (promesse) ----------
     opts : { titre, corps (Node|string HTML), actions:[{label, valeur, variante}] } → résout avec la valeur choisie (ou null) */
  CT.modal = function (opts) {
    return new Promise((resolve) => {
      const dlg = CT.h('dialog', { class: 'modal', 'aria-labelledby': 'modal-title' });
      const body = CT.h('div', { class: 'modal-body' });
      if (typeof opts.corps === 'string') body.innerHTML = opts.corps; else if (opts.corps) body.append(opts.corps);
      const foot = CT.h('div', { class: 'modal-foot' });
      (opts.actions || [{ label: 'Fermer', valeur: true, variante: 'primary' }]).forEach((a) =>
        foot.append(CT.h('button', { class: 'btn btn-' + (a.variante || 'secondary'), type: 'button', onclick: () => { dlg._val = a.valeur; if (dlg.close) dlg.close(); else { dlg.removeAttribute('open'); dlg.dispatchEvent(new Event('close')); } } }, a.label)));
      dlg.append(CT.h('div', { class: 'modal-head' }, CT.h('h2', { id: 'modal-title' }, opts.titre || '')), body, foot);
      dlg.addEventListener('close', () => { const v = dlg._val === undefined ? null : dlg._val; dlg.remove(); resolve(v); });
      document.body.append(dlg);
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    });
  };
  CT.confirmer = (titre, message, label = 'Confirmer', danger = false) =>
    CT.modal({ titre, corps: '<p>' + CT.esc(message) + '</p>', actions: [{ label: 'Annuler', valeur: false }, { label, valeur: true, variante: danger ? 'danger' : 'primary' }] });

  /* Session administrateur : déconnexion après N minutes SANS activité (N = data-inactivite, 30 par défaut).
     Tant que l'administrateur bouge la souris, tape ou fait défiler, la session est prolongée côté serveur (GET /session,
     au plus toutes les 90 s), même si la page ne recharge aucune donnée. Activité partagée entre les onglets (localStorage).
     Avertissement une minute avant ; à l'échéance, retour à la page de connexion. */
  document.addEventListener('DOMContentLoaded', () => {
    const zone = document.querySelector('.nav-user[data-inactivite]'); if (!zone) return;
    const limite = (+zone.dataset.inactivite || 30) * 60000, CLE = 'ct_activite_admin';
    let derniere = Date.now(), dernierPing = Date.now(), averti = false;
    const partagee = () => { try { return Math.max(derniere, +localStorage.getItem(CLE) || 0); } catch (e) { return derniere; } };
    const actif = () => {
      derniere = Date.now(); averti = false;
      try { localStorage.setItem(CLE, String(derniere)); } catch (e) { /* stockage indisponible : onglet seul */ }
      if (derniere - dernierPing > 90000 && CT.api) { dernierPing = derniere; CT.api.requete('/session').catch(() => {}); }   // 401 → page de connexion (api.js)
    };
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((ev) => window.addEventListener(ev, actif, { passive: true, capture: true }));
    let bouge = 0; window.addEventListener('mousemove', () => { if (Date.now() - bouge > 15000) { bouge = Date.now(); actif(); } }, { passive: true });
    setInterval(() => {
      const inactif = Date.now() - partagee();
      if (inactif >= limite) {
        // Vraie déconnexion côté serveur (formulaire du menu, sans confirmation), puis page de connexion « session expirée »
        const page = location.pathname.split('/').pop() || 'index.php', retour = (/^(index|parametres)\.php$/.test(page) ? page : 'index.php') + location.hash;
        const f = document.querySelector('form[action="deconnexion.php"]');
        if (!f) { location.href = 'connexion.php?expiree=1&retour=' + encodeURIComponent(retour); return; }
        [['motif', 'expiree'], ['retour', retour]].forEach(([n, v]) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); });
        f._confirme = true; f.submit();
      } else if (!averti && inactif >= limite - 60000 && CT.toast) {
        averti = true; CT.toast('Sans activité, vous serez déconnecté dans 1 minute.', 'warn', 15000);
      }
    }, 15000);
  });

  /* Bouton « Se déconnecter » du menu : confirmation Oui / Non avant d'envoyer le formulaire */
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.matches('form[action="deconnexion.php"]') || form._confirme) return;
    e.preventDefault();
    const oui = await CT.modal({ titre: 'Se déconnecter', corps: '<p>Voulez-vous vraiment vous déconnecter ?</p>',
      actions: [{ label: 'Non', valeur: false }, { label: 'Oui, me déconnecter', valeur: true, variante: 'danger' }] });
    if (oui) { form._confirme = true; form.submit(); }
  });

  /* ---------- Styles Excel (xlsx-js-style) : en-têtes en gras sur fond gris, lignes de total en gras ---------- */
  CT.styleEntete = function (ws) {
    if (!ws || !ws['!ref'] || !window.XLSX) return ws;
    const rg = XLSX.utils.decode_range(ws['!ref']);
    const fin = { style: 'thin', color: { rgb: '9CA3AF' } };
    for (let c = rg.s.c; c <= rg.e.c; c++) {
      const a = XLSX.utils.encode_cell({ r: rg.s.r, c });
      if (!ws[a]) ws[a] = { t: 's', v: '' };
      ws[a].s = { font: { bold: true, color: { rgb: '111827' } }, fill: { patternType: 'solid', fgColor: { rgb: 'D9D9D9' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { top: fin, bottom: fin, left: fin, right: fin } };
    }
    ws['!rows'] = ws['!rows'] || []; ws['!rows'][rg.s.r] = { hpt: 30 };
    return ws;
  };
  CT.styleTotaux = function (ws) {
    if (!ws || !ws['!ref'] || !window.XLSX) return ws;
    const rg = XLSX.utils.decode_range(ws['!ref']);
    // Lignes de total : gras, fond bleu clair, filet supérieur ; le format numérique de la cellule est conservé
    const filet = { style: 'medium', color: { rgb: '1D3FA8' } };
    for (let r = rg.s.r + 1; r <= rg.e.r; r++) {
      const l = [rg.s.c, rg.s.c + 1, rg.s.c + 2].map((c) => ws[XLSX.utils.encode_cell({ r, c })]).find((x) => x && /^(total|réseau|coût total)/i.test(String(x.v)));
      if (!l) continue;
      for (let c = rg.s.c; c <= rg.e.c; c++) {
        const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: 's', v: '' };
        ws[a].s = Object.assign({ font: { bold: true, color: { rgb: '0B1B3A' } }, fill: { patternType: 'solid', fgColor: { rgb: 'DCE6F7' } }, border: { top: filet } }, ws[a].z ? { numFmt: ws[a].z } : {});
      }
    }
    return ws;
  };

  /* ---------- Téléchargement ---------- */
  CT.telecharger = function (blob, nom) {
    const url = URL.createObjectURL(blob);
    const a = CT.h('a', { href: url, download: nom });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  CT.slug = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  CT.clone = (o) => JSON.parse(JSON.stringify(o));
  CT.somme = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
})();
