/* ============================================================================
   table.js — tableau triable, filtrable et paginé (équivalent allégé de DataTables,
   sans jQuery). Accessible : en-têtes boutons, aria-sort, légende, navigation clavier.
   Usage : const t = CT.table.creer({colonnes, lignes, ...}); conteneur.append(t.el); t.maj(nouvellesLignes)
   colonnes : [{cle, titre, num:bool, fmt:(valeur, ligne)=>string|HTML, html:bool, tri:(ligne)=>valeur}]
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  CT.table = {
    creer(opts) {
      const o = Object.assign({ pageSize: 15, recherche: false, caption: '', vide: 'Aucune donnée à afficher.', lignes: [] }, opts);
      let lignes = o.lignes, page = 0, requete = '';
      let tri = o.triInit ? { ...o.triInit } : null;
      const el = CT.h('div', { class: 'table-block' });
      const tools = CT.h('div', { class: 'table-tools no-print' });
      const wrap = CT.h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': o.caption || 'Tableau' });
      const pager = CT.h('div', { class: 'pager no-print' });
      if (o.recherche) {
        const inp = CT.h('input', { class: 'input input-sm', type: 'search', placeholder: 'Rechercher…', 'aria-label': 'Rechercher dans le tableau: ' + (o.caption || '') });
        inp.addEventListener('input', CT.debounce(() => { requete = inp.value.trim().toLowerCase(); page = 0; rendre(); }, 150));
        tools.append(inp);
      }
      if (o.outils) tools.append(o.outils);
      if (tools.childNodes.length) el.append(tools);
      el.append(wrap, pager);

      const valeur = (c, l) => (c.tri ? c.tri(l) : l[c.cle]);
      const texte = (c, l) => { const v = c.fmt ? c.fmt(l[c.cle], l) : l[c.cle]; return String(v == null ? '' : v).replace(/<[^>]+>/g, ''); };

      function filtrees() {
        let r = lignes;
        if (requete) r = r.filter((l) => o.colonnes.some((c) => texte(c, l).toLowerCase().includes(requete)));
        if (tri) {
          const c = o.colonnes.find((x) => x.cle === tri.cle);
          if (c) {
            const d = tri.dir === 'asc' ? 1 : -1;
            r = r.slice().sort((a, b) => {
              const va = valeur(c, a), vb = valeur(c, b);
              if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
              return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true })) * d;
            });
          }
        }
        return r;
      }

      function rendre() {
        const data = filtrees();
        const pages = Math.max(1, Math.ceil(data.length / o.pageSize));
        if (page >= pages) page = pages - 1;
        const vue = o.pageSize > 0 ? data.slice(page * o.pageSize, (page + 1) * o.pageSize) : data;
        const table = CT.h('table', { class: 'data' });
        if (o.caption) table.append(CT.h('caption', { class: 'sr-only' }, o.caption));
        const tr = CT.h('tr');
        o.colonnes.forEach((c) => {
          const th = CT.h('th', { scope: 'col', class: c.num ? 'num' : '' });
          const actif = tri && tri.cle === c.cle;
          th.setAttribute('aria-sort', actif ? (tri.dir === 'asc' ? 'ascending' : 'descending') : 'none');
          const b = CT.h('button', { type: 'button', title: 'Trier par ' + c.titre }, c.titre,
            CT.h('i', { class: 'fa-solid ' + (actif ? (tri.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'), 'aria-hidden': 'true', style: actif ? '' : 'opacity:.35' }));
          b.addEventListener('click', () => { tri = { cle: c.cle, dir: actif ? (tri.dir === 'asc' ? 'desc' : 'asc') : (c.num ? 'desc' : 'asc') }; rendre(); });
          th.append(b); tr.append(th);
        });
        table.append(CT.h('thead', {}, tr));
        const tb = CT.h('tbody');
        if (!vue.length) {
          tb.append(CT.h('tr', {}, CT.h('td', { colspan: o.colonnes.length, class: 'empty' }, o.vide)));
        }
        vue.forEach((l) => {
          const row = CT.h('tr', { class: o.classeLigne ? o.classeLigne(l) || '' : '' });
          o.colonnes.forEach((c) => {
            const td = CT.h('td', { class: c.num ? 'num' : '' });
            const v = c.fmt ? c.fmt(l[c.cle], l) : l[c.cle];
            if (c.html) td.innerHTML = v == null ? '' : v; else td.textContent = v == null ? '' : v;
            row.append(td);
          });
          tb.append(row);
        });
        table.append(tb);
        if (o.pied) {
          const f = CT.h('tr');
          o.colonnes.forEach((c) => {
            const td = CT.h('td', { class: c.num ? 'num' : '' });
            const v = o.pied[c.cle];
            if (c.html && c.fmt && typeof v === 'number') td.innerHTML = c.fmt(v, o.pied); else td.textContent = v == null ? '' : (c.fmt && typeof v === 'number' ? c.fmt(v, o.pied) : v);
            f.append(td);
          });
          table.append(CT.h('tfoot', {}, f));
        }
        wrap.replaceChildren(table);
        // Pagination
        pager.replaceChildren();
        if (o.pageSize > 0 && data.length > o.pageSize) {
          const prev = CT.h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { page--; rendre(); } }, 'Précédent');
          const next = CT.h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { page++; rendre(); } }, 'Suivant');
          prev.disabled = page === 0; next.disabled = page >= pages - 1;
          pager.append(CT.h('span', { 'aria-live': 'polite' }, CT.fmt.int(data.length) + ' lignes — page ' + (page + 1) + ' / ' + pages), prev, next);
        } else if (data.length) pager.append(CT.h('span', {}, CT.fmt.int(data.length) + ' ligne' + (data.length > 1 ? 's' : '')));
      }
      rendre();
      return { el, maj(n) { lignes = n; page = 0; rendre(); }, donnees: () => filtrees() };
    },
  };
})();
