/* ============================================================================
   objectifs.js — accès et conversions des objectifs (par équipe → login × B2B/B2C).
   Objectifs jour / semaine : repris tels quels du fichier importé par défaut ; calcul (mois ÷ base) si le mode « calcul » est choisi,
   ou automatiquement quand le fichier n'en fournit pas (valeur vide ou 0 alors que l'objectif du mois existe).
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const nombre = (v) => (typeof v === 'number' && isFinite(v) ? v : parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')) || 0);

  CT.objectifs = {
    get(cle) { return CT.store.actifs(cle).objectifs; },
    nbJoursOuvres: (obj) => obj.calendrier.ouvres.length,
    estOuvre: (obj, jour) => jour.slice(0, 7) === obj.periode && obj.calendrier.ouvres.includes(+jour.slice(8, 10)),
    /* Objectifs jour / semaine — deux modes (calendrier.mode_jour) :
       • « fichier » (PAR DÉFAUT) : valeurs lues telles quelles dans le fichier d'objectifs ; valeur absente → calculée ;
       • « calcul »  : jour = mois ÷ base (jours ouvrés ou base_jour), semaine = mois ÷ 4.
     Pas d'arrondi (règlement : « un objectif de 1,75 vente par jour demande donc 2 ventes ce jour-là »). */
    modeCalcul: (obj) => !!(obj && obj.calendrier && obj.calendrier.mode_jour === 'calcul'),
    baseJour: (obj) => +obj.calendrier.base_jour > 0 ? +obj.calendrier.base_jour : obj.calendrier.ouvres.length,
    calcJour: (mois, obj) => { const b = CT.objectifs.baseJour(obj); return b ? mois / b : 0; },
    calcSem: (mois) => mois / 4,
    jourLogin: (l, obj) => (CT.objectifs.modeCalcul(obj) || !(nombre(l && l.jour) > 0) ? CT.objectifs.calcJour(nombre(l.b2c) + nombre(l.b2b), obj) : nombre(l.jour)),
    semLogin: (l, obj) => (CT.objectifs.modeCalcul(obj) || !(nombre(l && l.semaine) > 0) ? CT.objectifs.calcSem(nombre(l.b2c) + nombre(l.b2b)) : nombre(l.semaine)),
    moisEq: (e) => e.logins.reduce((t, l) => t + nombre(l.b2c) + nombre(l.b2b), 0),
    jourEq: (e, obj) => (CT.objectifs.modeCalcul(obj) ? CT.objectifs.calcJour(CT.objectifs.moisEq(e), obj) : (nombre(e.jour) > 0 ? nombre(e.jour) : e.logins.reduce((t, l) => t + CT.objectifs.jourLogin(l, obj), 0))),
    semEq: (e, obj) => (CT.objectifs.modeCalcul(obj) ? CT.objectifs.calcSem(CT.objectifs.moisEq(e)) : (nombre(e.semaine) > 0 ? nombre(e.semaine) : e.logins.reduce((t, l) => t + CT.objectifs.semLogin(l, obj), 0))),
    // Total réseau : somme des équipes (mode fichier) ou calcul sur le total du mois (mode calcul)
    jourTot: (equipesJour, moisTot, obj) => (CT.objectifs.modeCalcul(obj) ? CT.objectifs.calcJour(moisTot, obj) : equipesJour),
    semTot: (equipesSem, moisTot, obj) => (CT.objectifs.modeCalcul(obj) ? CT.objectifs.calcSem(moisTot) : equipesSem),
    // Distribution intelligente : ajuste pour que la somme corresponde exactement à l'objectif mensuel
    distribuer: (total, parts) => {
      if (!total || !parts || parts.length === 0) return parts.map(() => 0);
      const base = Math.floor(total / parts.length);
      const reste = total - (base * parts.length);
      const result = parts.map(() => base);
      // Distribuer le reste aux premiers éléments
      for (let i = 0; i < reste; i++) result[i]++;
      return result;
    },
    /* Map cleLogin → {login, equipe, b2c, b2b, mois, primes, partRgz} */
    indexLogins(obj) {
      const m = new Map();
      obj.equipes.forEach((eq) => eq.logins.forEach((l) => m.set(CT.cleLogin(l.login), {
        login: l.login, equipe: eq.id, b2c: nombre(l.b2c), b2b: nombre(l.b2b), mois: nombre(l.b2c) + nombre(l.b2b), jour: CT.objectifs.jourLogin(l, obj), semaine: CT.objectifs.semLogin(l, obj),
        primes: l.primes !== false && nombre(l.b2c) + nombre(l.b2b) > 0, partRgz: eq.part_rgz,
      })));
      return m;
    },
    totaux(obj) {
      let b2c = 0, b2b = 0, jour = 0, semaine = 0;
      obj.equipes.forEach((e) => { e.logins.forEach((l) => { b2c += nombre(l.b2c); b2b += nombre(l.b2b); }); jour += CT.objectifs.jourEq(e, obj); semaine += CT.objectifs.semEq(e, obj); });
      return { b2c, b2b, mois: b2c + b2b, jour: CT.objectifs.jourTot(jour, b2c + b2b, obj), semaine: CT.objectifs.semTot(semaine, b2c + b2b, obj) };
    },

    /* ---- Import Excel : deux formats reconnus ----
       (1) fichier « OBJECTIFS TRACKING » d'origine : lignes équipe puis lignes login (B2B en col. F, B2C en col. G)
       (2) modèle exporté par l'outil : Équipe | Login | Obj. B2C | Obj. B2B | Primes | Part RGZ                     */
    depuisExcel(aoa) {
      const equipes = []; let cur = null;
      const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const hi = aoa.findIndex((r) => r && r.some((c) => norm(c) === 'login') && r.some((c) => /^obj.*b2c/.test(norm(c))));
      if (hi >= 0) {
        const head = aoa[hi].map(norm);
        const ci = (re) => head.findIndex((h) => re.test(h));
        const cE = ci(/^equipe/), cL = ci(/^login/), cC = ci(/b2c/), cB = ci(/b2b/), cP = ci(/prime/), cR = ci(/part/), cJ = ci(/^obj.*jour/), cS = ci(/^obj.*semaine/);
        for (const r of aoa.slice(hi + 1)) {
          if (!r || !r[cL]) continue;
          const id = String(r[cE] || '—').trim();
          cur = equipes.find((e) => e.id === id);
          if (!cur) { cur = { id, superviseur: null, segment: null, part_rgz: cR >= 0 && r[cR] !== '' && r[cR] != null ? nombre(r[cR]) : 0.2, logins: [] }; equipes.push(cur); }
          const b2c = nombre(r[cC]), b2b = nombre(r[cB]);
          cur.logins.push({ login: String(r[cL]).trim(), b2c, b2b, jour: cJ >= 0 ? Math.round(nombre(r[cJ])) : 0, semaine: cS >= 0 ? Math.round(nombre(r[cS])) : 0, primes: cP >= 0 ? !/^(non|0|false)$/i.test(String(r[cP]).trim()) && b2c + b2b > 0 : b2c + b2b > 0 });
        }
        return equipes;
      }
      // Format « OBJECTIFS TRACKING »
      aoa.forEach((r) => {
        if (!r) return;
        const b = r[1] == null ? '' : String(r[1]).trim();
        if (!b || /^(objectifs?|grand total)$/i.test(b)) return;
        const estLogin = /\.ftth$/i.test(b) || /^(pvt|pms|stg)[_-]/i.test(b);
        if (!estLogin) {
          if (typeof r[4] !== 'number' && typeof r[2] !== 'number') return; // ligne sans chiffres : pas une équipe
          const L = nombre(r[11]), N = nombre(r[13]);
          cur = { id: b, superviseur: null, segment: null, jour: typeof r[2] === 'number' ? Math.round(r[2]) : null, semaine: typeof r[3] === 'number' ? Math.round(r[3]) : null,
            fichier: { b2c: typeof r[6] === 'number' ? Math.round(r[6]) : null, b2b: typeof r[5] === 'number' ? Math.round(r[5]) : null, mois: typeof r[4] === 'number' ? Math.round(r[4]) : null }, part_rgz: L > 0 ? Math.round((N / L) * 10000) / 10000 : (/anonymat/i.test(b) ? 0 : 0.2), logins: [] };
          equipes.push(cur);
        } else if (cur) {
          const b2b = nombre(r[5]), b2c = nombre(r[6]);
          cur.logins.push({ login: b, b2c, b2b, jour: typeof r[2] === 'number' ? Math.round(r[2]) : 0, semaine: typeof r[3] === 'number' ? Math.round(r[3]) : 0, mois: typeof r[4] === 'number' ? Math.round(r[4]) : null, primes: b2b + b2c > 0 });
        }
      });
      return equipes;
    },
    /* Tableau à plat pour l'export Excel (format 2) */
    versExcel(obj) {
      const rows = [['Équipe', 'Login', 'Obj. B2C', 'Obj. B2B', 'Obj. Mois', 'Obj. Jour', 'Obj. Semaine', 'Primes', 'Part RGZ']];
      obj.equipes.forEach((e) => e.logins.forEach((l) => {
        const m = nombre(l.b2c) + nombre(l.b2b);
        rows.push([e.id, l.login, nombre(l.b2c), nombre(l.b2b), m, CT.objectifs.jourLogin(l, obj), CT.objectifs.semLogin(l, obj), l.primes === false ? 'Non' : 'Oui', e.part_rgz]);
      }));
      return rows;
    },
  };
})();
