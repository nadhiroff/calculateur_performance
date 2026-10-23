/* ============================================================================
   export.js — génération des classeurs Excel (SheetJS) et CSV, 100 % dans le navigateur.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const POURCENT = /(réalisation|tro|rythme|part de march|activation|évolution|taux|% atteinte)/i;
  const nomFeuille = (n, deja) => { let s = String(n).replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31) || 'Feuille'; let k = 2, b = s; while (deja.has(s)) s = b.slice(0, 28) + ' ' + k++; deja.add(s); return s; };

  /* ---------- Ligne TOTAL ----------
     Ajoutée en bas de chaque feuille tabulaire qui n'a pas déjà sa ligne de total (TOTAL / RÉSEAU / Coût total).
     Seules les colonnes ADDITIVES sont sommées : un pourcentage, un rang, une moyenne ou un identifiant additionnés
     donneraient un chiffre faux, leur cellule reste vide. */
  const LIGNE_TOTAL = /^(total|réseau|coût total)/i;
  const ADDITIVE = /(fcfa|montant|ventes|vendus|souscriptions|^ok$|^b2b$|^b2c$|en attente|^obj\.|réalisé|agents|journées|prime|^total|marge|commission|mois préc|projection|écart|^ca\b|one.?shot|part_rgz|part_vendeur)/i;
  const NON_ADDITIVE = /(rang|palier|trophée|moyen|%)/i;
  function avecTotal(def) {
    const aoa = def.aoa, entetes = aoa[0] || [];
    if (def.total === false || aoa.length < 3) return { aoa, ajoute: false };
    if (aoa.slice(1).some((r) => r && [r[0], r[1]].some((v) => LIGNE_TOTAL.test(String(v == null ? '' : v))))) return { aoa, ajoute: false };   // total déjà fourni par le module (simplement mis en valeur)
    const cols = entetes.map((h, c) => {
      const t = String(h == null ? '' : h);
      return ADDITIVE.test(t) && !NON_ADDITIVE.test(t) && !POURCENT.test(t) && aoa.slice(1).some((r) => r && typeof r[c] === 'number');
    });
    if (!cols.some(Boolean)) return { aoa, ajoute: false };   // feuille clé / valeur ou texte (KPI, Paramètres, Message…) : pas de total
    const somme = entetes.map((_, c) => (cols[c] ? Math.round(aoa.slice(1).reduce((s, r) => s + (r && typeof r[c] === 'number' ? r[c] : 0), 0) * 100) / 100 : ''));
    const colLibelle = cols.findIndex((x) => !x);   // 1re colonne non sommée (Équipe, Partenaire, ID…)
    somme[Math.max(colLibelle, 0)] = 'TOTAL (' + CT.fmt.int(aoa.length - 1) + ' lignes)';
    return { aoa: aoa.concat([somme]), ajoute: true };
  }

  /* Lignes TOTAL : une cellule égale à la somme exacte des lignes au-dessus devient une formule SUM (valeur en cache
     conservée), pour que le directeur puisse vérifier le calcul dans Excel. Ratios et totaux non additifs gardent leur valeur. */
  function formulesTotaux(ws, aoa) {
    const estTotal = (r) => r && [r[0], r[1], r[2]].some((v) => LIGNE_TOTAL.test(String(v == null ? '' : v)));
    aoa.forEach((r, R) => {
      if (!R || !estTotal(r)) return;
      r.forEach((v, C) => {
        if (typeof v !== 'number' || POURCENT.test(String(aoa[0][C] || ''))) return;
        const dessus = aoa.slice(1, R).map((x) => x && x[C]).filter((x) => typeof x === 'number');
        if (dessus.length < 2 || Math.abs(dessus.reduce((a, b) => a + b, 0) - v) > 0.005) return;
        const col = XLSX.utils.encode_col(C);
        ws[XLSX.utils.encode_cell({ r: R, c: C })].f = 'SUM(' + col + '2:' + col + R + ')';
      });
    });
  }

  function feuille(def) {
    const { aoa, ajoute } = avecTotal(def);
    def = Object.assign({}, def, { aoa });
    const ws = XLSX.utils.aoa_to_sheet(def.aoa);
    if (def.cols) ws['!cols'] = def.cols.map((w) => ({ wch: w }));
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = 1; R <= range.e.r; R++) for (let C = 0; C <= range.e.c; C++) {
      const a = XLSX.utils.encode_cell({ r: R, c: C }), c = ws[a]; if (!c || typeof c.v !== 'number') continue;
      const entete = def.aoa[0] && def.aoa[0][C], etiquette = def.aoa[R] && def.aoa[R][0];
      if (POURCENT.test(String(entete || '')) || (C === 1 && POURCENT.test(String(etiquette || '')))) c.z = '0.0%';
      else if (Number.isInteger(c.v)) c.z = '#,##0';
    }
    formulesTotaux(ws, def.aoa);
    CT.styleEntete(ws); CT.styleTotaux(ws); // en-têtes en gras sur fond gris, lignes TOTAL en gras
    // Le filtre automatique s'arrête au-dessus de la ligne TOTAL : un tri ne la déplace jamais au milieu des données
    if (def.aoa.length > 1 && def.filtre !== false) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r - (ajoute ? 1 : 0), c: range.e.c } }) };
    return ws;
  }
  function classeur(defs) {
    const wb = XLSX.utils.book_new(), noms = new Set();
    defs.forEach((d) => XLSX.utils.book_append_sheet(wb, feuille(d), nomFeuille(d.nom, noms)));
    return wb;
  }
  const blobXlsx = (defs) => new Blob([XLSX.write(classeur(defs), { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  CT.export = {
    classeur, blobXlsx,
    blobCsv(def) { return new Blob(['\ufeff' + XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(def.aoa), { FS: ';' })], { type: 'text/csv;charset=utf-8' }); },
    /* Données brutes : colonnes d'origine + SEGMENT + PARTENAIRE (calculés par l'outil), sur la période du tableau de bord */
    donneesBrutes() {
      const e = CT.etat, p = CT.dashboard.periodeDash(), L = e.lignes.filter((l) => !l.jour || (l.jour >= p.du && l.jour <= p.au));
      return { nom: 'Données brutes', filtre: true, cols: [], aoa: [(e.res.enteteBrut || []).concat(['SEGMENT', 'PARTENAIRE'])].concat(L.map((l) => (l.brut || []).concat([l.segment, l.partenaire]))) };
    },
    /* Export global : Données brutes, KPI, Point du jour, Performance partenaire, Objectifs */
    feuillesGlobales() {
      const e = CT.etat;
      // Toutes les feuilles de chaque vue : rien n'est laissé de côté
      return [CT.export.donneesBrutes()].concat(CT.dashboard.feuilles(), CT.pointJour.feuilles(), CT.perf.feuilles(), [{ nom: 'Objectifs', cols: [14, 32, 10, 10, 10, 10, 12, 8, 10], aoa: CT.objectifs.versExcel(e.motiv.objectifs) }]);
    },
  };
})();
