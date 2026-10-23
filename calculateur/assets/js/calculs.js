/* ============================================================================
   calculs.js — KPI, tops, répartitions, alertes, moteur de motivation (primes RGZ),
   performance par partenaire. Toutes les fonctions sont pures (entrées → sorties).
   Règle de comptage (conforme aux fichiers fournis) : seules les ventes STATUS = « OK »
   sont des ventes validées ; « VALIDE » = en attente (suivi séparé, non comptée).
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const pctDe = (a, b) => (b > 0 ? a / b : 0);
  const compte = (R, l) => (R.statuts_comptes || ['OK']).includes(l.statut);

  const C = (CT.calc = {
    /* ---------- Filtres dynamiques ---------- */
    filtrer(lignes, f) {
      return lignes.filter((l) =>
        (!f.du || (l.jour && l.jour >= f.du)) && (!f.au || (l.jour && l.jour <= f.au)) &&
        (!f.agence || l.agence === f.agence) && (!f.login || l.loginKey === f.login) && (!f.offre || l.offre === f.offre) &&
        (!f.typeClient || l.typeClient === f.typeClient) && (!f.statut || l.statut === f.statut) && (!f.partenaire || l.partenaire === f.partenaire));
    },

    /* ---------- KPI globaux ---------- */
    kpis(lignes, { seuil = 1e6, inclureAtypiques = false } = {}) {
      let ok = 0, valide = 0, ca = 0, nMont = 0, atyp = 0, atypMontant = 0;
      for (const l of lignes) {
        if (l.statut === 'OK') ok++; else if (l.statut === 'VALIDE') valide++;
        if (l.montant > seuil && !inclureAtypiques) { atyp++; atypMontant += l.montant; } else { ca += l.montant; nMont++; }
      }
      return { total: lignes.length, ok, valide, taux: pctDe(ok, lignes.length), ca, panier: nMont ? ca / nMont : 0, atyp, atypMontant,
        b2b: lignes.filter((l) => l.segment === 'B2B').length, b2c: lignes.filter((l) => l.segment === 'B2C').length };
    },
    /* Comptages groupés : [{cle, n, ok, ca}] triés par volume */
    grouper(lignes, fnCle, seuil = 1e6) {
      const m = new Map();
      for (const l of lignes) {
        const k = fnCle(l); if (k == null || k === '') continue;
        let g = m.get(k); if (!g) { g = { cle: k, n: 0, ok: 0, ca: 0 }; m.set(k, g); }
        g.n++; if (l.statut === 'OK') g.ok++; if (l.montant <= seuil) g.ca += l.montant;
      }
      return [...m.values()].sort((a, b) => b.n - a.n);
    },
    horaire(lignes) { const h = Array(24).fill(0); lignes.forEach((l) => { if (l.heure != null) h[l.heure]++; }); return h; },
    quotidien(lignes) {
      const m = new Map(); lignes.forEach((l) => { if (l.jour) { const g = m.get(l.jour) || { jour: l.jour, n: 0, ok: 0 }; g.n++; if (l.statut === 'OK') g.ok++; m.set(l.jour, g); } });
      return [...m.values()].sort((a, b) => (a.jour < b.jour ? -1 : 1));
    },

    /* ======================================================================
       MOTIVATION (périmètre du partenaire prioritaire, RGZ par défaut)
       Reproduit les onglets Tableau du jour / Suivi Agents / Suivi Équipes / Classement / Budget
       du Plan de motivation, à partir des souscriptions OK.
       ====================================================================== */
    /* Deux « fenêtres » de dates dans le mois de `cle` (toutes deux se terminent à `jourRef`) :
         • cumul  : de `du` (défaut : 1er du mois) à jourRef → ventes réalisées, TRO, rythme, paliers, budget ;
         • période: de `jourDu` (défaut : jourRef, soit une seule journée) à jourRef → « ventes du jour »,
                    objectif de la période, journées réussies / champion / primes de la période.
       Avec les valeurs par défaut, le résultat est celui d'une journée unique (comportement historique).
       Objectif de la période = objectif journalier × nombre de jours ouvrés de la période (une journée seule : × 1). */
    motivation(lignes, { cle, jourRef, prioritaire = 'RGZ', du = null, jourDu = null }) {
      const P = CT.store.actifs(cle), obj = P.objectifs, R = P.regles, A = R.agent, S = R.superviseur;
      const idx = CT.objectifs.indexLogins(obj);
      const nbOuvres = CT.objectifs.nbJoursOuvres(obj);
      const debutMois = cle + '-01';
      const cumulDu = du && du > debutMois ? du : debutMois;
      const perDu = jourDu && jourDu > cumulDu ? jourDu : (jourDu ? cumulDu : jourRef);
      const jours = CT.date.joursDuMois(cle).filter((j) => j >= cumulDu && j <= jourRef);
      const joursP = jours.filter((j) => j >= perDu);
      const ouvre = (j) => CT.objectifs.estOuvre(obj, j);
      const ouvresEcoules = jours.filter(ouvre).length;
      const estPlage = perDu < jourRef;                        // plusieurs jours demandés
      const ouvresP = joursP.filter(ouvre).length;
      const facteur = estPlage ? ouvresP : (ouvre(jourRef) ? 1 : 0);   // nb de « journées d'objectif » (jour non ouvré : aucun objectif)
      const partielle = cumulDu > debutMois;                   // cumul ne partant pas du 1er : objectifs au prorata
      const comm = obj.commission_one_shot || { b2c: 0, b2b: 0 };

      // Ventes validées du partenaire, par login : jours, segments
      const par = new Map();
      const brutParCle = new Map(); // orthographes rencontrées
      for (const l of lignes) {
        if (l.partenaire !== prioritaire || !compte(R, l) || !l.jour || l.jour.slice(0, 7) !== cle || l.jour > jourRef || l.jour < cumulDu) continue;
        let g = par.get(l.loginKey); if (!g) { g = { jours: new Map(), b2c: 0, b2b: 0 }; par.set(l.loginKey, g); }
        g.jours.set(l.jour, (g.jours.get(l.jour) || 0) + 1);
        if (l.segment === 'B2B') g.b2b++; else g.b2c++;
        if (!brutParCle.has(l.loginKey)) brutParCle.set(l.loginKey, new Set()); brutParCle.get(l.loginKey).add(l.login);
      }

      // Liste d'agents : tous ceux des objectifs + logins inconnus ayant vendu
      const agents = [];
      idx.forEach((o, k) => agents.push({ cleLogin: k, login: o.login, equipe: o.equipe, objB2C: o.b2c, objB2B: o.b2b, objMois: o.mois, objJourF: o.jour, objSemF: o.semaine, primes: o.primes, partRgz: o.partRgz, horsObjectif: false }));
      par.forEach((_, k) => { if (!idx.has(k)) agents.push({ cleLogin: k, login: [...brutParCle.get(k)][0], equipe: 'À préciser', objB2C: 0, objB2B: 0, objMois: 0, objJourF: 0, objSemF: 0, primes: false, partRgz: 0.2, horsObjectif: true }); });
      agents.forEach((a) => {
        const g = par.get(a.cleLogin) || { jours: new Map(), b2c: 0, b2b: 0 };
        a.g = g; a.objJour = a.objJourF; a.objSemaine = a.objSemF; a.objPeriode = a.objJour * facteur;
        a.realB2C = g.b2c; a.realB2B = g.b2b; a.real = g.b2c + g.b2b;
        a.ventesJour = CT.somme(joursP, (j) => g.jours.get(j) || 0);   // ventes de la période (= du jour si une seule journée)
        a.maxJour = Math.max(0, ...joursP.map((j) => g.jours.get(j) || 0));
        a.journeesReussies = 0; a.foisChampion = 0; a.joursReussiesP = 0; a.joursChampionP = 0;
      });

      // Boucle journalière : journées réussies, champion du jour, journées d'équipe
      const equipesIds = obj.equipes.map((e) => e.id);
      const eq = new Map(equipesIds.map((id) => [id, { id, journeesReussies: 0, jourReussie: false, ventesJour: 0, joursReussiesP: 0 }]));
      for (const j of jours) {
        const dansP = j >= perDu;
        const oj = ouvre(j);
        let best = null;
        const ventesEq = new Map();
        for (const a of agents) {
          const v = a.g.jours.get(j) || 0;
          ventesEq.set(a.equipe, (ventesEq.get(a.equipe) || 0) + v);
          if (oj && a.primes && a.objJour > 0 && v + 1e-9 >= a.objJour) {
            a.journeesReussies++; if (dansP) a.joursReussiesP++;
            const real = v / a.objJour;
            if (!best || real > best.real + 1e-9 || (Math.abs(real - best.real) < 1e-9 && v > best.v)) best = { a, real, v };
          }
        }
        if (best) { best.a.foisChampion++; if (dansP) best.a.joursChampionP++; }
        obj.equipes.forEach((e) => {
          const t = eq.get(e.id);
          const objJ = CT.somme(e.logins, (l) => CT.objectifs.jourLogin(l, obj));
          if (oj && objJ > 0 && (ventesEq.get(e.id) || 0) + 1e-9 >= objJ) { t.journeesReussies++; if (dansP) { t.joursReussiesP++; if (!estPlage) t.jourReussie = true; } }
        });
      }
      // Champion : une seule journée → champion du jour ; plusieurs jours → agent ayant été le plus souvent champion
      // (à égalité : le plus de ventes sur la période)
      let championJour = null;
      {
        const cand = agents.filter((a) => a.joursChampionP > 0).sort((x, y) => y.joursChampionP - x.joursChampionP || y.ventesJour - x.ventesJour)[0];
        if (cand) championJour = { login: cand.login, equipe: cand.equipe, ventes: cand.ventesJour, jours: cand.joursChampionP, realisation: cand.objPeriode > 0 ? cand.ventesJour / cand.objPeriode : null };
      }

      // Agents : cumul, TRO, paliers, primes
      agents.forEach((a) => {
        a.objADate = Math.round(a.objJour * ouvresEcoules);
        a.tro = pctDe(a.real, partielle ? a.objADate : a.objMois);
        a.rythme = pctDe(a.real, a.objADate);
        a.reste = Math.max(0, a.objMois - a.real);
        a.realisation = a.objPeriode > 0 ? a.ventesJour / a.objPeriode : null;
        a.atteint = a.primes && a.objPeriode > 0 && a.ventesJour + 1e-9 >= a.objPeriode;
        a.statutJour = !a.primes ? (a.objMois > 0 ? 'Non éligible' : 'Sans objectif') : (a.atteint ? 'Oui' : 'Non');
        a.champion = !!(championJour && championJour.login === a.login);
        a.primeJour = a.joursReussiesP * A.journee_reussie;            // somme des journées réussies de la période
        a.primeChampion = a.joursChampionP * A.champion_du_jour.prime;
        a.totalPrimesJour = a.primeJour + a.primeChampion;
        const pal = a.primes ? CT.regles.palierAgent(R, a.tro) : null;
        a.palier = pal ? pal.nom : 'Aucun'; a.primePalier = pal ? pal.prime : 0;
        a.primesJournees = a.primes ? a.journeesReussies * A.journee_reussie : 0;
        a.primesChampion = a.primes ? a.foisChampion * A.champion_du_jour.prime : 0;
        a.bonusB2B = a.primes && a.objB2B > 0 && a.realB2B >= a.objB2B ? A.bonus_b2b : 0;
        a.totalPrimes = a.primePalier + a.primesJournees + a.primesChampion + a.bonusB2B;
        a.commission = a.realB2C * comm.b2c + a.realB2B * comm.b2b;
      });
      const eligibles = agents.filter((a) => a.primes).sort((x, y) => y.tro - x.tro || y.real - x.real);
      eligibles.forEach((a, i) => { a.rang = i + 1; });

      // Équipes
      const equipes = obj.equipes.map((e) => {
        const ags = agents.filter((a) => a.equipe === e.id);
        const t = eq.get(e.id);
        const objB2C = CT.somme(ags, (a) => a.objB2C), objB2B = CT.somme(ags, (a) => a.objB2B), objMois = objB2C + objB2B;
        const real = CT.somme(ags, (a) => a.real), realB2C = CT.somme(ags, (a) => a.realB2C), realB2B = CT.somme(ags, (a) => a.realB2B);
        const objJour = CT.objectifs.jourEq(e, obj), objSemaine = CT.objectifs.semEq(e, obj), objPeriode = objJour * facteur, ventesJour = CT.somme(ags, (a) => a.ventesJour);
        const avecObj = ags.filter((a) => a.primes).length, actifs = ags.filter((a) => a.primes && a.tro + 1e-9 >= S.activation.seuil_agent).length;
        const tauxAct = pctDe(actifs, avecObj);
        const tro = pctDe(real, partielle ? objJour * ouvresEcoules : objMois);
        const bloque = tauxAct + 1e-9 < S.activation.taux_min;
        const pal = bloque ? null : CT.regles.palierSup(R, tro);
        const jourReussie = estPlage ? (objPeriode > 0 && ventesJour + 1e-9 >= objPeriode) : t.jourReussie;
        return { id: e.id, superviseur: e.superviseur, partRgz: e.part_rgz, objB2C, objB2B, objMois, objJour, objSemaine, objPeriode, real, realB2C, realB2B, ventesJour, tro,
          realisation: objPeriode > 0 ? ventesJour / objPeriode : null, rythme: pctDe(real, objJour * ouvresEcoules),
          jourReussie, journeesReussies: t.journeesReussies, primesJournees: t.journeesReussies * S.journee_equipe,
          primeSupJour: t.joursReussiesP * S.journee_equipe, joursReussiesP: t.joursReussiesP,
          agentsAvecObjectif: avecObj, agentsActifs: actifs, tauxActivation: tauxAct,
          agentsVendeurs: ags.filter((a) => a.ventesJour > 0).length, agentsAtteints: ags.filter((a) => a.atteint).length,
          palier: bloque ? 'Bloqué (activation)' : (pal ? pal.nom : 'Aucun'), primeFinMois: pal ? pal.prime : 0, trophee: 0,
          marge: (realB2C * (obj.commission_one_shot || {}).b2c + realB2B * (obj.commission_one_shot || {}).b2b) * e.part_rgz };
      });
      const rangEq = [...equipes].sort((a, b) => b.tro - a.tro || b.real - a.real);
      rangEq.forEach((e, i) => { e.rang = i + 1; });
      if (rangEq[0] && rangEq[0].tro + 1e-9 >= S.trophee.tro_min && rangEq[0].real > 0) rangEq[0].trophee = S.trophee.enveloppe;
      equipes.forEach((e) => { e.totalSup = e.primesJournees + e.primeFinMois + e.trophee; });

      // Réseau (équipes + logins hors objectifs)
      const horsEq = agents.filter((a) => a.horsObjectif);
      const horsVentesJour = CT.somme(horsEq, (a) => a.ventesJour);
      const objMoisTot = CT.somme(equipes, (e) => e.objMois), objJourTot = CT.objectifs.jourTot(CT.somme(equipes, (e) => e.objJour), objMoisTot, obj), objSemaineTot = CT.objectifs.semTot(CT.somme(equipes, (e) => e.objSemaine), objMoisTot, obj), objPeriodeTot = objJourTot * facteur;
      const ventesJourEq = CT.somme(equipes, (e) => e.ventesJour);
      // realisation : null si la période ne contient aucun jour ouvré (pas d'objectif → pas de taux)
      const reseau = { objMois: objMoisTot, objJour: objJourTot, objSemaine: objSemaineTot, objPeriode: objPeriodeTot, ventesJourEquipes: ventesJourEq, horsEquipeJour: horsVentesJour, ventesJour: ventesJourEq + horsVentesJour,
        realisation: objPeriodeTot <= 0 ? null : pctDe(ventesJourEq + horsVentesJour, objPeriodeTot), real: CT.somme(agents, (a) => a.real), realB2C: CT.somme(agents, (a) => a.realB2C), realB2B: CT.somme(agents, (a) => a.realB2B),
        agentsAvecObjectif: CT.somme(equipes, (e) => e.agentsAvecObjectif), agentsVendeurs: CT.somme(equipes, (e) => e.agentsVendeurs), agentsAtteints: CT.somme(equipes, (e) => e.agentsAtteints),
        primeSupJour: CT.somme(equipes, (e) => e.primeSupJour), primesAgentsJour: CT.somme(agents, (a) => a.totalPrimesJour) };
      reseau.tro = pctDe(reseau.real, partielle ? objJourTot * ouvresEcoules : objMoisTot); reseau.objADate = Math.round(objJourTot * ouvresEcoules); reseau.rythme = pctDe(reseau.real, reseau.objADate);

      // Budget (coût du plan vs marge RGZ)
      const coutAg = { journees: CT.somme(agents, (a) => a.primesJournees), champion: CT.somme(agents, (a) => a.primesChampion), paliers: CT.somme(agents, (a) => a.primePalier), bonusB2B: CT.somme(agents, (a) => a.bonusB2B) };
      const coutSup = { journees: CT.somme(equipes, (e) => e.primesJournees), finMois: CT.somme(equipes, (e) => e.primeFinMois), trophee: CT.somme(equipes, (e) => e.trophee) };
      const cout = CT.somme(Object.values(coutAg)) + CT.somme(Object.values(coutSup));
      const marge = CT.somme(equipes, (e) => e.marge);
      const budget = { coutAg, coutSup, cout, marge, ratio: marge > 0 ? cout / marge : null };

      return { cle, jourRef, du: cumulDu, jourDu: perDu, estPlage, partielle, nbJoursPeriode: joursP.length, ouvresPeriode: ouvresP, facteur,
        ouvre: estPlage ? ouvresP > 0 : ouvre(jourRef), objectifs: obj, regles: R, herite: P.herite, nbOuvres, ouvresEcoules, prioritaire, comm,
        agents, equipes, reseau, champion: championJour, classement: eligibles.slice(0, 10), budget,
        orthographes: brutParCle, horsEquipe: horsEq };
    },

    /* ---------- Points d'attention (Point du jour) ---------- */
    pointsAttention(m, lignes) {
      const out = [], L = CT.loginCourt;
      const jref = m.jourRef, ou = m.ouvre, plage = m.estPlage, jdu = m.jourDu;
      const jourSem = CT.date.JOURS[CT.date.dow(jref)];
      const quand = plage ? 'sur la période du ' + CT.date.court(jdu) + ' au ' + CT.date.court(jref) : 'un ' + jourSem;
      if (!ou) out.push({ sujet: plage ? 'Aucun jour ouvré' : 'Jour non ouvré', constat: plage ? 'La période du ' + CT.date.court(jdu) + ' au ' + CT.date.court(jref) + " ne contient aucun jour ouvré du calendrier." : CT.date.long(jref) + " n'est pas un jour ouvré dans le calendrier du mois.", action: "Les ventes comptent pour le mois ; aucune prime journalière n'est calculée." });
      const zero = m.equipes.filter((e) => e.objMois > 0 && e.ventesJour === 0);
      if (ou && zero.length) out.push({ sujet: 'Équipes à zéro', constat: zero.map((e) => e.id).join(', ') + (zero.length > 1 ? " n'ont" : " n'a") + ' aucune vente ' + quand + '.', action: 'Appeler ' + (zero.length > 1 ? 'les ' + zero.length + ' superviseurs' : 'le superviseur') + ' en priorité.' });
      const fortes = m.agents.filter((a) => a.maxJour >= 8 || (a.objMois > 0 && a.maxJour >= a.objMois / 3));
      if (fortes.length) out.push({ sujet: 'Journées exceptionnelles', constat: fortes.map((a) => L(a.login) + ' (' + a.maxJour + ' ventes' + (plage ? ' en une journée' : '') + (a.objMois ? ', objectif mois ' + a.objMois : '') + ')').join(' ; '), action: "Vérifier qu'il s'agit de ventes du jour et non d'activations accumulées validées d'un coup, avant d'annoncer le champion." });
      const inconnus = m.horsEquipe.filter((a) => a.real > 0);
      if (inconnus.length) out.push({ sujet: 'Login inconnu', constat: inconnus.map((a) => a.login + ' a ' + a.real + ' vente(s) ' + (m.partielle ? 'sur la période' : 'ce mois')).join(' ; ') + " mais n'a ni équipe ni objectif.", action: "Préciser son équipe. Sans objectif, il est suivi mais n'a pas droit aux primes." });
      const ecarts = [];
      m.orthographes.forEach((set, k) => { const ag = m.agents.find((a) => a.cleLogin === k); if (ag && !ag.horsObjectif) set.forEach((raw) => { if (raw !== ag.login.trim().toLowerCase()) ecarts.push(raw + ' ≠ ' + ag.login); }); });
      if (ecarts.length) out.push({ sujet: 'Écart de logins', constat: "Le rapport Celtiis et le fichier d'objectifs n'écrivent pas les mêmes logins : " + [...new Set(ecarts)].slice(0, 6).join(' ; ') + '.', action: "Harmoniser les logins, sinon le rapprochement dans Power BI échouera (l'outil les rapproche automatiquement)." });
      const valides = lignes.filter((l) => l.partenaire === m.prioritaire && l.jour >= jdu && l.jour <= jref && l.statut === 'VALIDE').length;
      if (valides) out.push({ sujet: 'Ventes en attente', constat: valides + ' souscription(s) ' + m.prioritaire + ' en statut VALIDE ' + (plage ? 'sur la période' : 'ce jour') + ', non comptées (seules les ventes OK le sont).', action: 'Relancer la validation Celtiis pour les intégrer au compteur.' });
      out.push({ sujet: plage ? 'Objectif de la période' : 'Objectif du jour', constat: 'Calculé sur ' + m.nbOuvres + ' jours ouvrés (objectif du mois ÷ ' + m.nbOuvres + ')' + (plage ? ', multiplié par les ' + m.ouvresPeriode + ' jour(s) ouvré(s) de la période.' : '.'), action: 'Garder une seule convention pour tout le mois (modifiable dans Paramètres › Objectifs › calendrier).' });
      if (!CT.objectifs.modeCalcul(m.objectifs)) {
        const nb = m.nbOuvres, diff = m.agents.filter((x) => !x.horsObjectif && x.objMois > 0 && Math.abs(x.objJour - x.objMois / nb) > 0.01);
        if (diff.length) { const ex = diff.slice(0, 3).map((x) => L(x.login) + ' : ' + CT.fmt.nat(x.objJour) + ' au lieu de ' + CT.fmt.nat(x.objMois / nb)).join(' ; ');
          out.push({ sujet: 'Objectif du jour du fichier', constat: diff.length + ' vendeur(s) ont un objectif du jour (fichier d\'objectifs) différent de « objectif du mois ÷ ' + nb + ' jours ouvrés » prévu par le règlement. Exemples : ' + ex + '.', action: 'Pour suivre le règlement : Paramètres › Objectifs › Objectif journalier = « Calcul ». Sinon, garder les valeurs du fichier en connaissance de cause.' }); }
      }
      if (m.herite) out.push({ sujet: 'Paramètres hérités', constat: 'Aucun objectif propre à ' + CT.date.libelleMois(m.cle) + " : les objectifs d'une période précédente sont utilisés.", action: 'Créer le mois dans Paramètres › Objectifs (« + Nouveau mois »).' });
      return out;
    },

    /* ---------- Message WhatsApp du Point du jour ---------- */
    messageWhatsApp(m) {
      const j = m.jourRef, L = CT.loginCourt, r = m.reseau, plage = m.estPlage;
      const lignes = [];
      const titre = plage ? 'Point du ' + CT.date.court(m.jourDu) + ' au ' + CT.date.court(j) : 'Point du ' + CT.date.long(j).replace(/ \d{4}$/, '');
      lignes.push(titre + ' : ' + r.ventesJour + ' vente' + (r.ventesJour > 1 ? 's' : '') + (r.realisation == null || !r.objPeriode ? (m.ouvre ? ' (objectif non renseigné).' : ' (aucun jour ouvré : pas d\'objectif).') : ', ' + CT.fmt.txt(CT.fmt.pct(r.realisation)) + " de l'objectif " + (plage ? 'de la période' : 'du jour') + '.'));
      const brav = m.agents.filter((a) => a.atteint && !a.champion).sort((a, b) => b.ventesJour - a.ventesJour).map((a) => L(a.login));
      const per = plage ? 'de la période' : 'du jour';
      if (m.champion) lignes.push('Champion ' + per + ' : ' + L(m.champion.login) + ' (' + m.champion.equipe + '), ' + m.champion.ventes + ' vente' + (m.champion.ventes > 1 ? 's' : '') + '.' + (brav.length ? ' Bravo aussi à ' + brav.slice(0, 8).join(', ') + '.' : ''));
      else if (brav.length) lignes.push('Objectif ' + per + ' atteint par : ' + brav.slice(0, 8).join(', ') + '.');
      else lignes.push("Personne n'a atteint son objectif " + per + '.');
      const au = m.equipes.filter((e) => e.realisation != null && e.realisation >= 1).sort((a, b) => b.realisation - a.realisation);
      if (au.length) lignes.push('Équipes au-dessus de l\'objectif : ' + au.map((e) => e.id + ' (' + CT.fmt.txt(CT.fmt.pct(e.realisation)) + ')').join(' et ') + '.');
      const zero = m.equipes.filter((e) => e.objMois > 0 && e.ventesJour === 0).map((e) => e.id);
      const suite = plage ? ', aucune vente sur la période.' : ', on vous attend demain.';
      if (m.ouvre && zero.length) lignes.push(zero.length > 1 ? zero.slice(0, -1).join(', ') + ' et ' + zero[zero.length - 1] + suite : zero[0] + suite);
      return lignes;
    },

    /* ======================================================================
       PERFORMANCE PAR PARTENAIRE (tous partenaires, RGZ mis en avant)
       ====================================================================== */
    /* `du` (facultatif) : début de la période (défaut : 1er du mois). Seules les ventes de du → jourRef sont comptées ;
       la projection prolonge le rythme de la période (ventes ÷ jours ouvrés de la période) sur les jours ouvrés du mois. */
    perfPartenaires(lignes, { cle, jourRef, prioritaire = 'RGZ', cfg, du = null }) {
      const P = CT.store.actifs(cle), obj = P.objectifs, R = P.regles;
      const histo = (cfg.historique && cfg.historique.partenaires) || {};
      const debut = du && du > cle + '-01' ? du : cle + '-01';
      const jours = CT.date.joursDuMois(cle).filter((j) => j >= debut && j <= jourRef);
      const ouvresEcoules = jours.filter((j) => CT.objectifs.estOuvre(obj, j)).length, nbOuvres = CT.objectifs.nbJoursOuvres(obj);
      const comm = obj.commission_one_shot || { b2c: 0, b2b: 0 };
      const seuil = R.seuil_montant_atypique || 1e6;
      const m = new Map();
      for (const l of lignes) {
        if (!l.jour || l.jour.slice(0, 7) !== cle || l.jour > jourRef || l.jour < debut) continue;
        let g = m.get(l.partenaire); if (!g) { g = { partenaire: l.partenaire, ventes: 0, b2c: 0, b2b: 0, attente: 0, ca: 0, logins: new Set() }; m.set(l.partenaire, g); }
        if (compte(R, l)) { g.ventes++; if (l.segment === 'B2B') g.b2b++; else g.b2c++; if (l.montant <= seuil) g.ca += l.montant; g.logins.add(l.loginKey); }
        else if (l.statut === 'VALIDE') g.attente++;
      }
      histo && Object.keys(histo).forEach((n) => { if (!m.has(n)) m.set(n, { partenaire: n, ventes: 0, b2c: 0, b2b: 0, attente: 0, ca: 0, logins: new Set() }); });
      const mi = +cle.slice(5, 7) - 1; // index du mois courant (0 = janvier) ; l'historique couvre Jan→Sep
      const rows = [...m.values()].map((g) => {
        const h = histo[g.partenaire] || []; const prec = mi >= 1 && h[mi - 1] != null ? h[mi - 1] : 0;
        const projection = ouvresEcoules > 0 ? (g.ventes / ouvresEcoules) * nbOuvres : null;
        return { partenaire: g.partenaire, prioritaire: g.partenaire === prioritaire, ventes: g.ventes, b2c: g.b2c, b2b: g.b2b, attente: g.attente, ca: g.ca, nbLogins: g.logins.size,
          commission: g.b2c * comm.b2c + g.b2b * comm.b2b, histo: h, precedent: prec, projection: projection == null ? 0 : projection, nouveau: !(prec > 0) && g.ventes > 0,
          evolution: prec > 0 ? (projection == null ? 0 : projection) / prec - 1 : null, ecartPrec: (projection == null ? 0 : projection) - prec };
      }).sort((a, b) => b.ventes - a.ventes);
      const total = CT.somme(rows, (r) => r.ventes);
      rows.forEach((r, i) => { r.rang = i + 1; r.part = pctDe(r.ventes, total); });
      const tot = { partenaire: 'TOTAL', ventes: total, b2c: CT.somme(rows, (r) => r.b2c), b2b: CT.somme(rows, (r) => r.b2b), attente: CT.somme(rows, (r) => r.attente), ca: CT.somme(rows, (r) => r.ca),
        commission: CT.somme(rows, (r) => r.commission), nbLogins: CT.somme(rows, (r) => r.nbLogins), projection: CT.somme(rows, (r) => r.projection || 0),
        precedent: CT.somme(rows, (r) => r.precedent || 0) };
      tot.evolution = tot.precedent ? tot.projection / tot.precedent - 1 : null; tot.ecartPrec = tot.projection - tot.precedent;
      const labelsHisto = (cfg.historique && cfg.historique.mois) || [];
      return { rows, total: tot, ouvresEcoules, nbOuvres, moisIndex: mi, labelsHisto, histoTotal: labelsHisto.map((_, i) => CT.somme(Object.values(histo), (h) => h[i] || 0)) };
    },

    /* ======================================================================
       PERFORMANCE PAR LOGIN — One-Shot & commissions (partenaire prioritaire)
       One-Shot B2B = ventes B2B × 12 000 · One-Shot B2C = ventes B2C × 10 000 (montants paramétrables)
       Part RGZ = One-Shot × part de l'équipe (20 % ; 0 % pour ANONYMAT) · Part commercial = le reste (80 %)
       Taux de réalisation d'une équipe = ventes (B2B + B2C) ÷ objectif du mois.
       ====================================================================== */
    performanceLogins(lignes, { cle, jourRef, partenaire, motiv, du = null }) {
      const P = CT.store.actifs(cle), obj = P.objectifs, R = P.regles;
      const debut = du && du > cle + '-01' ? du : cle + '-01';
      const partielle = debut > cle + '-01', oe = motiv ? motiv.ouvresEcoules : 0;
      const comm = obj.commission_one_shot || { b2c: 10000, b2b: 12000 };
      const idx = CT.objectifs.indexLogins(obj);
      const agg = new Map();
      for (const l of lignes) {
        if (l.partenaire !== partenaire || !compte(R, l) || !l.jour || l.jour.slice(0, 7) !== cle || l.jour > jourRef || l.jour < debut) continue;
        let g = agg.get(l.loginKey); if (!g) { g = { b2b: 0, b2c: 0, login: l.login }; agg.set(l.loginKey, g); }
        if (l.segment === 'B2B') g.b2b++; else g.b2c++;
      }
      const mp = new Map(); if (motiv) motiv.agents.forEach((a) => mp.set(a.cleLogin, a));
      const ligne = (k, equipe, partRgz) => {
        const o = idx.get(k), g = agg.get(k) || { b2b: 0, b2c: 0, login: o ? o.login : k }, a = mp.get(k);
        const total = g.b2b + g.b2c, objMois = o ? o.mois : 0;
        const objRef = partielle ? (o ? o.jour : 0) * oe : objMois; // objectif de comparaison : mois entier, ou prorata de la période
        const oneShotB2B = g.b2b * comm.b2b, oneShotB2C = g.b2c * comm.b2c, oneShot = oneShotB2B + oneShotB2C, partR = oneShot * partRgz;
        return { cle: k, login: o ? o.login : g.login, loginCourt: CT.loginCourt(k), equipe, horsObjectif: !o, primes: o ? o.primes : false, b2b: g.b2b, b2c: g.b2c, total,
          objMois, objRef, objJour: o ? o.jour : 0, objSemaine: o ? o.semaine : 0, taux: objRef > 0 ? total / objRef : null,
          oneShotB2B, oneShotB2C, oneShot, partRgz: partR, partCommercial: oneShot - partR,
          palier: a ? a.palier : 'Aucun', primesPlan: a ? a.totalPrimes : 0 };
      };
      const somme = (rows) => ({ b2b: CT.somme(rows, (r) => r.b2b), b2c: CT.somme(rows, (r) => r.b2c), total: CT.somme(rows, (r) => r.total), objMois: CT.somme(rows, (r) => r.objMois), objRef: CT.somme(rows, (r) => r.objRef),
        oneShotB2B: CT.somme(rows, (r) => r.oneShotB2B), oneShotB2C: CT.somme(rows, (r) => r.oneShotB2C), oneShot: CT.somme(rows, (r) => r.oneShot), partRgz: CT.somme(rows, (r) => r.partRgz),
        partCommercial: CT.somme(rows, (r) => r.partCommercial), primesPlan: CT.somme(rows, (r) => r.primesPlan) });
      const tri = (rows) => rows.sort((a, b) => b.total - a.total || a.login.localeCompare(b.login));
      const equipes = obj.equipes.map((e) => {
        const rows = tri(e.logins.map((l) => ligne(CT.cleLogin(l.login), e.id, e.part_rgz)));
        const t = somme(rows);
        return Object.assign({ id: e.id, superviseur: e.superviseur, partRgzTaux: e.part_rgz, objJour: CT.objectifs.jourEq(e, obj), objSemaine: CT.objectifs.semEq(e, obj), taux: t.objRef > 0 ? t.total / t.objRef : null, rows }, t);
      });
      const inconnus = tri([...agg.keys()].filter((k) => !idx.has(k)).map((k) => ligne(k, 'À préciser', 0.2)));
      if (inconnus.length) { const t = somme(inconnus); equipes.push(Object.assign({ id: 'À préciser', superviseur: null, partRgzTaux: 0.2, objJour: 0, objSemaine: 0, taux: null, rows: inconnus }, t)); }
      const all = [].concat(...equipes.map((e) => e.rows)); const t = somme(all);
      return { partenaire, commission: comm, equipes, rows: all, partielle, du: debut, total: Object.assign({ objJour: CT.objectifs.jourTot(CT.somme(equipes, (q) => q.objJour), t.objMois, obj), objSemaine: CT.objectifs.semTot(CT.somme(equipes, (q) => q.objSemaine), t.objMois, obj), taux: t.objRef > 0 ? t.total / t.objRef : null }, t) };
    },

    /* ======================================================================
       COMMISSIONS & PRIMES PAR ÉQUIPE ET PAR TYPE DE VENTE (partenaire prioritaire)
       Commission One-Shot = ventes × montant du segment (B2C 10 000 / B2B 12 000, paramétrables),
       partagée entre les vendeurs (VTB) et le partenaire (part de l'équipe, 20 % ; 0 % pour ANONYMAT).
       Primes de performance (plan de motivation, `motiv`) :
         • B2C vendeurs  = journées réussies + champion + paliers TRO des agents ;   • B2B vendeurs = bonus B2B des agents ;
         • B2C partenaire = journées d'équipe des superviseurs ;  atteinte objectif = palier fin de mois + trophée ;
         • B2B partenaire : aucune règle dans le plan (0, signalé).
       mode 'periode' (Point du jour) : seules les primes de la période (journées, champion, journées d'équipe) ;
       paliers, bonus B2B et trophée sont des primes de fin de mois → 0.
       L'équipe ANONYMAT est isolée (lignes « Équipe Anonymat »), les autres forment les « vendeurs VTB ». */
    commissionsPrimes(lignes, { cle, du, au, partenaire, motiv, mode = 'cumul' }) {
      const P = CT.store.actifs(cle), obj = P.objectifs, R = P.regles;
      const comm = obj.commission_one_shot || { b2c: 0, b2b: 0 };
      const idx = CT.objectifs.indexLogins(obj);
      const anonymat = (id) => /anonymat/i.test(id);
      const eqs = new Map(obj.equipes.map((e) => [e.id, { id: e.id, part: e.part_rgz, anonymat: anonymat(e.id), b2c: 0, b2b: 0 }]));
      for (const l of lignes) {
        if (l.partenaire !== partenaire || !compte(R, l) || !l.jour || l.jour < du || l.jour > au) continue;
        const o = idx.get(l.loginKey), id = o ? o.equipe : 'À préciser';
        if (!eqs.has(id)) eqs.set(id, { id, part: 0.2, anonymat: false, b2c: 0, b2b: 0 });
        if (l.segment === 'B2B') eqs.get(id).b2b++; else eqs.get(id).b2c++;
      }
      const periode = mode === 'periode';
      const equipes = [...eqs.values()].map((q) => {
        const ags = motiv ? motiv.agents.filter((a) => a.equipe === q.id) : [], me = motiv ? motiv.equipes.find((x) => x.id === q.id) : null;
        const comB2C = q.b2c * comm.b2c, comB2B = q.b2b * comm.b2b;
        const primeB2CVendeurs = periode ? CT.somme(ags, (a) => a.totalPrimesJour) : CT.somme(ags, (a) => a.primesJournees + a.primesChampion + a.primePalier);
        const primeB2BVendeurs = periode ? 0 : CT.somme(ags, (a) => a.bonusB2B);
        const primeEquipe = me ? (periode ? me.primeSupJour : me.primesJournees) : 0;
        const primeObjectif = me && !periode ? me.primeFinMois + me.trophee : 0;
        return { id: q.id, anonymat: q.anonymat, partTaux: q.part, b2c: q.b2c, b2b: q.b2b, ventes: q.b2c + q.b2b,
          comB2C, comB2B, comB2CVendeurs: comB2C * (1 - q.part), comB2CRgz: comB2C * q.part, comB2BVendeurs: comB2B * (1 - q.part), comB2BRgz: comB2B * q.part,
          primeB2CVendeurs, primeB2BVendeurs, primeEquipe, primeObjectif, objectifAtteint: me ? (periode ? me.jourReussie : me.tro >= 1) : false,
          totalCommissions: comB2C + comB2B, totalPrimes: primeB2CVendeurs + primeB2BVendeurs + primeEquipe + primeObjectif };
      }).filter((q) => q.ventes > 0 || obj.equipes.some((e) => e.id === q.id));
      const S = (rows, f) => CT.somme(rows, f), vtb = equipes.filter((q) => !q.anonymat), ano = equipes.filter((q) => q.anonymat);
      const pr = partenaire;
      // Les 13 lignes demandées, regroupées par type de vente ; « regle » = d'où vient le montant (affiché sous la ligne)
      const groupes = [
        { id: 'b2c', titre: 'Ventes B2C (particuliers)', icone: 'fa-house-user', lignes: [
          { nom: 'Commissions B2C vendeurs VTB', type: 'commission', montant: S(vtb, (q) => q.comB2CVendeurs), regle: S(vtb, (q) => q.b2c) + ' ventes × ' + CT.fmt.int(comm.b2c) + ' FCFA, part des vendeurs' },
          { nom: 'Commissions B2C Partenaire ' + pr, type: 'commission', montant: S(vtb, (q) => q.comB2CRgz), regle: 'Part ' + pr + ' (taux de l\'équipe) des commissions B2C' },
          { nom: 'Prime de performance B2C vendeurs VTB', type: 'prime', montant: S(vtb, (q) => q.primeB2CVendeurs), regle: periode ? 'Journées réussies + champion de la période' : 'Journées réussies + champion + paliers du mois' },
          { nom: 'Prime de performance B2C Partenaire ' + pr, type: 'prime', montant: S(vtb, (q) => q.primeEquipe), regle: 'Journées d\'équipe réussies (superviseurs)' },
          { nom: 'Prime de performance B2C Partenaire ' + pr + ' atteinte objectif', type: 'prime', montant: S(vtb, (q) => q.primeObjectif), regle: periode ? 'Versée en fin de mois (palier superviseur + trophée)' : 'Palier superviseur de fin de mois + trophée' }] },
        { id: 'b2b', titre: 'Ventes B2B (entreprises)', icone: 'fa-building', lignes: [
          { nom: 'Commissions B2B vendeurs VTB', type: 'commission', montant: S(vtb, (q) => q.comB2BVendeurs), regle: S(vtb, (q) => q.b2b) + ' ventes × ' + CT.fmt.int(comm.b2b) + ' FCFA, part des vendeurs' },
          { nom: 'Commissions B2B Partenaire ' + pr, type: 'commission', montant: S(vtb, (q) => q.comB2BRgz), regle: 'Part ' + pr + ' (taux de l\'équipe) des commissions B2B' },
          { nom: 'Prime de performance B2B vendeurs VTB', type: 'prime', montant: S(vtb, (q) => q.primeB2BVendeurs), regle: periode ? 'Bonus B2B versé en fin de mois' : 'Bonus B2B : objectif B2B du mois atteint' },
          { nom: 'Prime de performance B2B Partenaire ' + pr, type: 'prime', montant: 0, regle: 'Aucune règle dans le plan de motivation (à définir)', aDefinir: true }] },
        { id: 'anonymat', titre: 'Équipe Anonymat', icone: 'fa-user-secret', lignes: [
          { nom: 'Commissions B2C Équipe Anonymat', type: 'commission', montant: S(ano, (q) => q.comB2C), regle: S(ano, (q) => q.b2c) + ' ventes × ' + CT.fmt.int(comm.b2c) + ' FCFA, tout pour les vendeurs' },
          { nom: 'Commissions B2B Équipe Anonymat', type: 'commission', montant: S(ano, (q) => q.comB2B), regle: S(ano, (q) => q.b2b) + ' ventes × ' + CT.fmt.int(comm.b2b) + ' FCFA, tout pour les vendeurs' },
          { nom: 'Prime de performance B2C Équipe Anonymat', type: 'prime', montant: S(ano, (q) => q.primeB2CVendeurs + q.primeEquipe + q.primeObjectif), regle: 'Primes des vendeurs et du superviseur de l\'équipe' },
          { nom: 'Prime de performance B2B Équipe Anonymat', type: 'prime', montant: S(ano, (q) => q.primeB2BVendeurs), regle: 'Bonus B2B des vendeurs de l\'équipe' }] },
      ];
      groupes.forEach((g) => { g.total = S(g.lignes, (x) => x.montant); g.equipes = (g.id === 'anonymat' ? ano : vtb).filter((q) => q.id !== 'À préciser' || q.ventes > 0).map((q) => q.id); });
      // Gains de chaque vendeur : sa part des commissions One-Shot + ses primes (du plan ou de la période)
      const vendeurs = (motiv ? motiv.agents : []).map((a) => {
        const part = a.horsObjectif ? 0.2 : a.partRgz, ventesB2C = a.realB2C, ventesB2B = a.realB2B;
        const commission = (ventesB2C * comm.b2c + ventesB2B * comm.b2b) * (1 - part), primes = periode ? a.totalPrimesJour : a.totalPrimes;
        return { login: a.login, equipe: a.equipe, b2c: ventesB2C, b2b: ventesB2B, commission, primes, gain: commission + primes, palier: a.palier, tro: a.tro, horsObjectif: a.horsObjectif };
      }).filter((v) => v.gain > 0).sort((a, b) => b.gain - a.gain);
      // Potentiel : ce que rapporterait l'objectif du mois atteint à 100 % (colonnes ONE_SHOT du fichier d'objectifs)
      const pot = { commissions: 0, partenaire: 0 };
      obj.equipes.forEach((e) => e.logins.forEach((l) => { const c = (+l.b2c || 0) * comm.b2c + (+l.b2b || 0) * comm.b2b; pot.commissions += c; pot.partenaire += c * e.part_rgz; }));
      const total = { b2c: S(equipes, (q) => q.b2c), b2b: S(equipes, (q) => q.b2b), commissions: S(equipes, (q) => q.totalCommissions), primes: S(equipes, (q) => q.totalPrimes),
        vendeurs: S(equipes, (q) => q.comB2CVendeurs + q.comB2BVendeurs + q.primeB2CVendeurs + q.primeB2BVendeurs), partenaire: S(vtb, (q) => q.comB2CRgz + q.comB2BRgz) };
      total.general = total.commissions + total.primes;
      // Projection fin de mois des commissions : rythme des jours ouvrés écoulés prolongé sur le mois (mode cumul uniquement)
      const oe = motiv ? motiv.ouvresEcoules : 0, nbO = motiv ? motiv.nbOuvres : 0;
      total.projection = !periode && oe > 0 ? (total.commissions / oe) * nbO : null;
      // Équipe gagnante = n°1 du classement du plan (meilleur % de son objectif, comme pour le trophée), si elle a vendu
      const premiere = motiv ? motiv.equipes.find((x) => x.rang === 1 && x.real > 0) : null;
      return { comm, equipes, groupes, total, vendeurs, potentiel: pot, gagnante: premiere ? premiere.id : null, mode, du, au };
    },

    /* ======================================================================
       PÉRIODE SUR PLUSIEURS MOIS
       Chaque mois est calculé à part avec SES objectifs et SES règles (un mois sans paramètres reprend ceux du mois connu
       le plus proche, cf. store.actifs), puis les résultats sont additionnés : objectifs, ventes, commissions et primes.
       Les taux (TRO, rythme, réalisation) sont recalculés sur les totaux, jamais additionnés.
       ====================================================================== */
    /* Tranches mensuelles de [du → au] : [{ cle, du, au }] dans l'ordre chronologique */
    tranches(du, au) {
      const out = [];
      for (let d = du; d <= au;) {
        const cle = d.slice(0, 7), fin = CT.date.joursDuMois(cle).pop();
        out.push({ cle, du: d, au: fin < au ? fin : au });
        d = CT.date.ajouter(fin, 1);
      }
      return out;
    },

    /* Une motivation par mois → un résultat de même forme (agents, équipes, réseau, budget, champion, classement) */
    combinerMotivations(segs) {
      if (segs.length === 1) return segs[0];
      const der = segs[segs.length - 1], sum = (a, b, cles) => cles.forEach((k) => { a[k] = (a[k] || 0) + (b[k] || 0); });
      const SA = ['objB2C', 'objB2B', 'objMois', 'objPeriode', 'objADate', 'realB2C', 'realB2B', 'real', 'ventesJour', 'journeesReussies', 'foisChampion', 'joursReussiesP', 'joursChampionP',
        'primeJour', 'primeChampion', 'totalPrimesJour', 'primePalier', 'primesJournees', 'primesChampion', 'bonusB2B', 'totalPrimes', 'commission'];
      const SE = ['objB2C', 'objB2B', 'objMois', 'objPeriode', 'real', 'realB2C', 'realB2B', 'ventesJour', 'journeesReussies', 'primesJournees', 'primeSupJour', 'joursReussiesP', 'primeFinMois', 'trophee', 'totalSup', 'marge'];
      const ags = new Map(), eqs = new Map(), orth = new Map();
      segs.forEach((s) => {
        // TRO d'un mois : réalisé ÷ objectif du mois (ou objectif à date si le mois n'est couvert qu'à partir d'une date)
        s.agents.forEach((a) => {
          const c = ags.get(a.cleLogin), objTro = s.partielle ? a.objADate : a.objMois;
          if (!c) { ags.set(a.cleLogin, Object.assign({}, a, { objTro })); return; }
          sum(c, a, SA); c.objTro += objTro; c.maxJour = Math.max(c.maxJour, a.maxJour);
          // Libellés (équipe, objectif du jour, palier…) : ceux du mois le plus récent
          ['login', 'equipe', 'objJour', 'objSemaine', 'objJourF', 'objSemF', 'primes', 'partRgz', 'horsObjectif', 'palier'].forEach((k) => { c[k] = a[k]; });
        });
        s.equipes.forEach((e) => {
          const c = eqs.get(e.id), objADate = e.objJour * s.ouvresEcoules, objTro = s.partielle ? objADate : e.objMois;
          const pro = (o) => (s.partielle && s.nbOuvres > 0 ? (o * s.ouvresEcoules) / s.nbOuvres : o);
          const ext = { objADate, objTro, objB2CPeriode: pro(e.objB2C), objB2BPeriode: pro(e.objB2B) };
          if (!c) { eqs.set(e.id, Object.assign({}, e, ext)); return; }
          sum(c, e, SE); sum(c, ext, Object.keys(ext));
          ['superviseur', 'partRgz', 'objJour', 'objSemaine', 'agentsAvecObjectif', 'agentsActifs', 'tauxActivation', 'palier'].forEach((k) => { c[k] = e[k]; });
        });
        (s.orthographes || new Map()).forEach((v, k) => { const o = orth.get(k) || new Set(); v.forEach((x) => o.add(x)); orth.set(k, o); });
      });

      const agents = [...ags.values()];
      agents.forEach((a) => {
        a.objADate = Math.round(a.objADate);
        a.tro = pctDe(a.real, a.objTro); a.rythme = pctDe(a.real, a.objADate);
        a.reste = Math.max(0, a.objMois - a.real);
        a.realisation = a.objPeriode > 0 ? a.ventesJour / a.objPeriode : null;
        a.atteint = a.primes && a.objPeriode > 0 && a.ventesJour + 1e-9 >= a.objPeriode;
        a.statutJour = !a.primes ? (a.objMois > 0 ? 'Non éligible' : 'Sans objectif') : (a.atteint ? 'Oui' : 'Non');
      });
      const cand = agents.filter((a) => a.joursChampionP > 0).sort((x, y) => y.joursChampionP - x.joursChampionP || y.ventesJour - x.ventesJour)[0];
      const champion = cand ? { login: cand.login, equipe: cand.equipe, ventes: cand.ventesJour, jours: cand.joursChampionP, realisation: cand.objPeriode > 0 ? cand.ventesJour / cand.objPeriode : null } : null;
      agents.forEach((a) => { a.champion = !!(champion && champion.login === a.login); a.rang = undefined; });
      const eligibles = agents.filter((a) => a.primes).sort((x, y) => y.tro - x.tro || y.real - x.real);
      eligibles.forEach((a, i) => { a.rang = i + 1; });

      // Équipes : ordre du mois le plus récent, puis celles qui n'existent que dans un mois antérieur
      const ordre = der.equipes.map((e) => e.id).concat([...eqs.keys()].filter((id) => !der.equipes.some((e) => e.id === id)));
      const equipes = ordre.map((id) => {
        const e = eqs.get(id), membres = agents.filter((a) => a.equipe === id);
        e.objB2CPeriode = Math.round(e.objB2CPeriode); e.objB2BPeriode = Math.round(e.objB2BPeriode);
        e.tro = pctDe(e.real, e.objTro); e.rythme = pctDe(e.real, e.objADate);
        e.realisation = e.objPeriode > 0 ? e.ventesJour / e.objPeriode : null;
        e.jourReussie = e.objPeriode > 0 && e.ventesJour + 1e-9 >= e.objPeriode;
        e.agentsVendeurs = membres.filter((a) => a.ventesJour > 0).length; e.agentsAtteints = membres.filter((a) => a.atteint).length;
        return e;
      });
      [...equipes].sort((a, b) => b.tro - a.tro || b.real - a.real).forEach((e, i) => { e.rang = i + 1; });

      const horsEq = agents.filter((a) => a.horsObjectif), r0 = der.reseau;
      const reseau = { objJour: r0.objJour, objSemaine: r0.objSemaine, objADate: 0, objTro: 0 };
      segs.forEach((s) => {
        sum(reseau, s.reseau, ['objMois', 'objPeriode', 'ventesJourEquipes', 'horsEquipeJour', 'ventesJour', 'real', 'realB2C', 'realB2B', 'primeSupJour', 'primesAgentsJour']);
        reseau.objADate += s.reseau.objJour * s.ouvresEcoules;
        reseau.objTro += s.partielle ? s.reseau.objJour * s.ouvresEcoules : s.reseau.objMois;
      });
      reseau.objADate = Math.round(reseau.objADate);
      reseau.tro = pctDe(reseau.real, reseau.objTro); reseau.rythme = pctDe(reseau.real, reseau.objADate);
      reseau.realisation = reseau.objPeriode <= 0 ? null : pctDe(reseau.ventesJour, reseau.objPeriode);
      ['agentsAvecObjectif', 'agentsVendeurs', 'agentsAtteints'].forEach((k) => { reseau[k] = CT.somme(equipes, (e) => e[k]); });

      const budget = { coutAg: {}, coutSup: {}, cout: 0, marge: 0 };
      segs.forEach((s) => { sum(budget.coutAg, s.budget.coutAg, Object.keys(s.budget.coutAg)); sum(budget.coutSup, s.budget.coutSup, Object.keys(s.budget.coutSup)); budget.cout += s.budget.cout; budget.marge += s.budget.marge; });
      budget.ratio = budget.marge > 0 ? budget.cout / budget.marge : null;

      const S = (f) => CT.somme(segs, f);
      return Object.assign({}, der, { du: segs[0].du, jourDu: segs[0].jourDu, estPlage: true, partielle: true, multiMois: true, segments: segs,
        nbJoursPeriode: S((s) => s.nbJoursPeriode), ouvresPeriode: S((s) => s.ouvresPeriode), facteur: S((s) => s.facteur), ouvre: segs.some((s) => s.ouvre),
        nbOuvres: S((s) => s.nbOuvres), ouvresEcoules: S((s) => s.ouvresEcoules),
        agents, equipes, reseau, champion, classement: eligibles.slice(0, 10), budget, orthographes: orth, horsEquipe: horsEq });
    },

    /* Commissions & primes de chaque mois (chacun dans son mode : 'cumul' s'il est couvert depuis le 1er, sinon 'periode') → total */
    combinerPrimes(list, motiv) {
      if (list.length === 1) return list[0];
      const der = list[list.length - 1], S = CT.somme;
      const NQ = ['b2c', 'b2b', 'ventes', 'comB2C', 'comB2B', 'comB2CVendeurs', 'comB2CRgz', 'comB2BVendeurs', 'comB2BRgz', 'primeB2CVendeurs', 'primeB2BVendeurs', 'primeEquipe', 'primeObjectif', 'totalCommissions', 'totalPrimes'];
      const eqs = new Map();
      list.forEach((cp) => cp.equipes.forEach((q) => {
        const c = eqs.get(q.id);
        if (!c) { eqs.set(q.id, Object.assign({}, q)); return; }
        NQ.forEach((k) => { c[k] += q[k]; }); c.objectifAtteint = q.objectifAtteint; c.partTaux = q.partTaux;
      }));
      const equipes = [...eqs.values()];
      // Lignes : montants additionnés ; nombre de ventes de la règle additionné, sinon règles des différents mois
      const groupes = der.groupes.map((g, gi) => {
        const lignes = g.lignes.map((x, li) => {
          const toutes = list.map((cp) => cp.groupes[gi].lignes[li]), montant = S(toutes, (t) => t.montant);
          const nb = toutes.map((t) => /^(\d+) ventes/.exec(t.regle || ''));
          const regle = nb.every(Boolean) ? (S(nb, (m) => +m[1])) + x.regle.replace(/^\d+/, '')
            : [...new Set(toutes.map((t) => t.regle))].join(' / ');
          return Object.assign({}, x, { montant, regle });
        });
        const ids = new Set(); list.forEach((cp) => cp.groupes[gi].equipes.forEach((id) => ids.add(id)));
        return Object.assign({}, g, { lignes, total: S(lignes, (x) => x.montant), equipes: [...ids] });
      });
      const vend = new Map();
      list.forEach((cp) => cp.vendeurs.forEach((v) => {
        const c = vend.get(v.login);
        if (!c) { vend.set(v.login, Object.assign({}, v)); return; }
        ['b2c', 'b2b', 'commission', 'primes', 'gain'].forEach((k) => { c[k] += v[k]; }); c.equipe = v.equipe; c.palier = v.palier; c.horsObjectif = v.horsObjectif;
      }));
      if (motiv) vend.forEach((v) => { const a = motiv.agents.find((x) => x.login === v.login); if (a) v.tro = a.tro; });
      const total = {};
      ['b2c', 'b2b', 'commissions', 'primes', 'vendeurs', 'partenaire', 'general'].forEach((k) => { total[k] = S(list, (cp) => cp.total[k]); });
      // Projection : mois terminés tels quels + projection du dernier mois
      total.projection = S(list.slice(0, -1), (cp) => cp.total.commissions) + (der.total.projection != null ? der.total.projection : der.total.commissions);
      const premiere = motiv ? motiv.equipes.find((x) => x.rang === 1 && x.real > 0) : null;
      return { comm: der.comm, equipes, groupes, total, vendeurs: [...vend.values()].sort((a, b) => b.gain - a.gain),
        potentiel: { commissions: S(list, (cp) => cp.potentiel.commissions), partenaire: S(list, (cp) => cp.potentiel.partenaire) },
        gagnante: premiere ? premiere.id : der.gagnante, mode: list.every((cp) => cp.mode === 'cumul') ? 'cumul' : 'periode', multiMois: true, du: list[0].du, au: der.au };
    },

    /* Performance par login de chaque mois → total (un login est rangé dans son équipe la plus récente) */
    combinerPerfLogins(list) {
      if (list.length === 1) return list[0];
      const der = list[list.length - 1], N = ['b2b', 'b2c', 'total', 'objMois', 'objRef', 'oneShotB2B', 'oneShotB2C', 'oneShot', 'partRgz', 'partCommercial', 'primesPlan'];
      const rows = new Map(), infoEq = new Map();
      list.forEach((pl) => pl.equipes.forEach((q) => {
        infoEq.set(q.id, { id: q.id, superviseur: q.superviseur, partRgzTaux: q.partRgzTaux, objJour: q.objJour, objSemaine: q.objSemaine });
        q.rows.forEach((r) => {
          const c = rows.get(r.cle);
          if (!c) { rows.set(r.cle, Object.assign({}, r)); return; }
          N.forEach((k) => { c[k] += r[k]; });
          ['login', 'equipe', 'horsObjectif', 'primes', 'objJour', 'objSemaine', 'palier'].forEach((k) => { c[k] = r[k]; });
        });
      }));
      const somme = (rs) => { const t = {}; N.forEach((k) => { t[k] = CT.somme(rs, (r) => r[k]); }); return t; };
      const all = [...rows.values()]; all.forEach((r) => { r.taux = r.objRef > 0 ? r.total / r.objRef : null; });
      const tri = (rs) => rs.sort((a, b) => b.total - a.total || a.login.localeCompare(b.login));
      const ordre = der.equipes.map((q) => q.id).concat([...infoEq.keys()].filter((id) => !der.equipes.some((q) => q.id === id)));
      const equipes = ordre.map((id) => {
        const rs = tri(all.filter((r) => r.equipe === id)), t = somme(rs);
        return Object.assign({}, infoEq.get(id), { taux: t.objRef > 0 ? t.total / t.objRef : null, rows: rs }, t);
      }).filter((q) => q.rows.length);
      const flat = [].concat(...equipes.map((q) => q.rows)), t = somme(flat);
      return Object.assign({}, der, { equipes, rows: flat, partielle: true, du: list[0].du,
        total: Object.assign({}, der.total, t, { taux: t.objRef > 0 ? t.total / t.objRef : null }) });
    },

    /* Performance partenaires de chaque mois → total (projection, historique et évolution : ceux du dernier mois) */
    combinerPerfPartenaires(list) {
      if (list.length === 1) return list[0];
      const der = list[list.length - 1], N = ['ventes', 'b2c', 'b2b', 'attente', 'ca', 'commission'];
      const m = new Map();
      // ventesDernier : ventes du dernier mois seul (colonne du mois en cours de l'historique)
      list.forEach((p, i) => p.rows.forEach((r) => {
        const c = m.get(r.partenaire);
        if (!c) { m.set(r.partenaire, Object.assign({}, r, { ventesDernier: i === list.length - 1 ? r.ventes : 0 })); return; }
        if (i === list.length - 1) c.ventesDernier = r.ventes;
        N.forEach((k) => { c[k] += r[k]; }); c.nbLogins = Math.max(c.nbLogins, r.nbLogins);
        if (i === list.length - 1) ['histo', 'precedent', 'projection', 'nouveau', 'evolution', 'ecartPrec'].forEach((k) => { c[k] = r[k]; });
      }));
      const rows = [...m.values()].sort((a, b) => b.ventes - a.ventes), total = CT.somme(rows, (r) => r.ventes);
      rows.forEach((r, i) => { r.rang = i + 1; r.part = pctDe(r.ventes, total); });
      const tot = Object.assign({}, der.total);
      N.concat(['nbLogins']).forEach((k) => { tot[k] = CT.somme(rows, (r) => r[k]); });
      return Object.assign({}, der, { rows, total: tot, ouvresEcoules: CT.somme(list, (p) => p.ouvresEcoules) });
    },

    /* ---------- Alertes automatiques (Dashboard) ---------- */
    alertes(lignes, m) {
      const out = [];
      if (m) {
        const L = CT.loginCourt;
        if (m.ouvresEcoules >= 3) {
          const faibles = m.agents.filter((a) => a.primes && a.objADate > 0 && a.rythme < 0.5).sort((a, b) => a.rythme - b.rythme);
          if (faibles.length) out.push({ niveau: 'neg', titre: faibles.length + ' vendeur' + (faibles.length > 1 ? 's' : '') + ' ' + m.prioritaire + ' sous-performant' + (faibles.length > 1 ? 's' : ''), detail: 'Rythme < 50 % : ' + faibles.slice(0, 5).map((a) => L(a.login) + ' (' + CT.fmt.pct(a.rythme) + ')').join(', ') + (faibles.length > 5 ? '…' : '') });
        }
        const ecart = m.reseau.real - m.reseau.objADate;
        if (m.reseau.objADate > 0) out.push({ niveau: ecart >= 0 ? 'pos' : 'warn', titre: ecart >= 0 ? 'Réseau ' + m.prioritaire + ' en avance sur l\'objectif' : 'Réseau ' + m.prioritaire + ' en retard sur l\'objectif', detail: CT.fmt.int(Math.abs(ecart)) + ' vente(s) ' + (ecart >= 0 ? "d'avance" : 'de retard') + ' sur ' + CT.fmt.int(m.reseau.objADate) + ' attendues à date (' + CT.fmt.pct(m.reseau.rythme) + ').' });
        const faiblesEq = m.equipes.filter((e) => m.ouvresEcoules >= 3 && e.objMois > 0 && e.objJour > 0 && e.rythme < 0.5);   // sans objectif du jour, pas de rythme
        if (faiblesEq.length) out.push({ niveau: 'warn', titre: 'Équipes très en retard', detail: faiblesEq.map((e) => e.id + ' (' + CT.fmt.pct(e.rythme) + ')').join(', ') });
        if (m.champion) out.push(m.estPlage
          ? { niveau: 'pos', titre: 'Champion de la période', detail: L(m.champion.login) + ' (' + m.champion.equipe + ') — champion ' + m.champion.jours + ' jour(s), ' + m.champion.ventes + ' ventes du ' + CT.date.court(m.jourDu) + ' au ' + CT.date.court(m.jourRef) + '.' }
          : { niveau: 'pos', titre: 'Champion du jour', detail: L(m.champion.login) + ' (' + m.champion.equipe + ') — ' + m.champion.ventes + ' ventes le ' + CT.date.court(m.jourRef) + '.' });
      }
      // Offres en baisse : dernier jour ouvré vs moyenne des jours ouvrés précédents (offres ≥ 30 lignes)
      const q = C.quotidien(lignes).filter((d) => { const w = CT.date.dow(d.jour); return w >= 1 && w <= 5; });
      if (q.length >= 3) {
        const dernier = q[q.length - 1].jour, prec = q.slice(0, -1).map((d) => d.jour);
        const offres = C.grouper(lignes, (l) => l.offre).filter((g) => g.n >= 30);
        const baisses = [];
        offres.forEach((g) => {
          const nDer = lignes.filter((l) => l.offre === g.cle && l.jour === dernier).length;
          const moy = lignes.filter((l) => l.offre === g.cle && prec.includes(l.jour)).length / prec.length;
          if (moy >= 5 && nDer < moy * 0.5) baisses.push(g.cle + ' (' + nDer + ' vs ' + CT.fmt.dec(moy, 0) + '/j)');
        });
        if (baisses.length) out.push({ niveau: 'warn', titre: 'Offres en baisse le ' + CT.date.court(dernier), detail: baisses.join(', ') });
      }
      const k = C.kpis(lignes);
      if (k.total && k.valide / k.total > 0.1) out.push({ niveau: 'info', titre: 'Part élevée de souscriptions en attente', detail: CT.fmt.pct(k.valide / k.total, 1) + ' des lignes sont en statut VALIDE (non comptées comme ventes).' });
      if (!out.length) out.push({ niveau: 'pos', titre: 'Aucune alerte', detail: 'Tous les indicateurs surveillés sont dans la norme.' });
      return out;
    },
  });
})();
