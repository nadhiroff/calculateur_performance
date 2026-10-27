/* ============================================================================
   regles.js — accès aux règles de motivation (paliers, primes, commissions) d'une période.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  CT.regles = {
    /* Règles actives pour un mois (« 2026-10 ») */
    get(cle) { return CT.store.actifs(cle).regles; },
    /* Palier atteint pour un TRO : dernier palier dont le seuil est ≤ TRO */
    palier(paliers, tro) {
      let res = null;
      [...paliers].sort((a, b) => a.seuil - b.seuil).forEach((p) => { if (tro + 1e-9 >= p.seuil) res = p; });
      return res; // null = « Aucun »
    },
    palierAgent(R, tro) { return CT.regles.palier(R.agent.paliers_tro, tro); },
    palierSup(R, tro) { return CT.regles.palier(R.superviseur.paliers_tro, tro); },
    /* Un segment est-il B2B ? (règle par défaut : TYPE_CLIENT = ORGANISATION) */
    estB2B(R, typeClient) { return String(typeClient || '').toUpperCase() === String((R.segment_b2b || {}).valeur || 'ORGANISATION').toUpperCase(); },
    /* Clé de comparaison d'un NOM_OFFRE : casse, accents et espaces multiples ignorés (même règle que OffresComptees.php) */
    cleOffre(o) { return String(o == null ? '' : o).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); },
    /* Offres comptées du mois (absentes des règles enregistrées : valeurs par défaut) ; liste vide = toutes les offres */
    offresComptees(R) { return (R && Array.isArray(R.offres_comptees) ? R.offres_comptees : (CT.DEFAUTS.regles.offres_comptees || [])).filter((o) => String(o).trim()); },
    /* Filtre (offre → booléen) pour des règles données */
    filtreOffres(R) {
      const cles = new Set(CT.regles.offresComptees(R).map(CT.regles.cleOffre));
      return (offre) => !cles.size || cles.has(CT.regles.cleOffre(offre));
    },
  };
})();
