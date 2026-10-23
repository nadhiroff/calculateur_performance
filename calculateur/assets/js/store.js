/* ============================================================================
   store.js — paramètres actifs (objectifs, règles, partenaires) : base MySQL via l'API Laravel (CT.api).
   • Valeurs par défaut embarquées (config/defaults.js, copie de config/*.json).
   • Chaque mois a ses propres objectifs ET règles : periodes["2026-10"] = {objectifs, regles}.
   • À chaque sauvegarde, l'évènement window « parametersUpdated » est émis
     (le tableau de bord et les rapports se recalculent automatiquement).
   • AUCUN localStorage : toutes les données sont stockées en base de données MySQL.
   AUCUNE donnée de souscription n'est stockée ici.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  let etat = null;

  function defauts() {
    const d = CT.DEFAUTS;
    return { version: 1, modifie: null,
      periodes: { [d.objectifs.periode]: { objectifs: CT.clone(d.objectifs), regles: CT.clone(d.regles) } },
      partenaires: CT.clone(d.partenaires) };
  }
  function migrerHistorique(stored, defaut) {
    let migre = false;
    const storedHisto = stored.partenaires.historique || { mois: [], partenaires: {} };
    const defautHisto = defaut.partenaires.historique || { mois: [], partenaires: {} };

    // Si le nombre de mois est différent, on met à jour
    if (storedHisto.mois.length !== defautHisto.mois.length) {
      const oldLen = storedHisto.mois.length;
      const newLen = defautHisto.mois.length;

      // Mettre à jour la liste des mois
      storedHisto.mois = defautHisto.mois.slice();
      storedHisto.annee = defautHisto.annee;

      // Pour chaque partenaire, ajouter les mois manquants avec des zéros
      Object.keys(storedHisto.partenaires).forEach((part) => {
        const vals = storedHisto.partenaires[part];
        while (vals.length < newLen) {
          vals.push(0);
        }
      });

      // Ajouter les nouveaux partenaires qui n'existent pas dans le stockage
      Object.keys(defautHisto.partenaires).forEach((part) => {
        if (!storedHisto.partenaires[part]) {
          storedHisto.partenaires[part] = defautHisto.partenaires[part].slice();
        }
      });

      stored.partenaires.historique = storedHisto;
      migre = true;
    }

    return migre;
  }

  function migrerPartenaires(stored, defaut) {
    let migre = false;
    const storedPart = stored.partenaires;
    const defautPart = defaut.partenaires;

    // Fusionner les alias_login : ajouter les nouveaux, garder les existants
    Object.keys(defautPart.alias_login || {}).forEach((key) => {
      if (!storedPart.alias_login[key]) {
        storedPart.alias_login[key] = defautPart.alias_login[key];
        migre = true;
      }
    });

    // Fusionner les règles d'agence : ajouter les nouvelles
    const defautRegles = defautPart.regles_agence || [];
    const storedRegles = storedPart.regles_agence || [];
    defautRegles.forEach((nouvelle) => {
      const existe = storedRegles.some((r) => r.motif === nouvelle.motif && r.partenaire === nouvelle.partenaire);
      if (!existe) {
        storedRegles.push(nouvelle);
        migre = true;
      }
    });

    // Mettre à jour partenaire prioritaire et défaut si non modifiés par l'utilisateur
    // (on garde les valeurs de l'utilisateur s'il les a changées)

    return migre;
  }

  function migrerPeriodes(stored, defaut) {
    let migre = false;
    // Pour l'instant, on ne migre pas les périodes automatiquement
    // car les objectifs et règles sont spécifiques à chaque mois
    // Si besoin, on peut ajouter une logique ici pour fusionner des champs
    return migre;
  }

  function migrerTout(stored, defaut) {
    const changements = [];
    if (migrerHistorique(stored, defaut)) changements.push('historique');
    if (migrerPartenaires(stored, defaut)) changements.push('partenaires');
    if (migrerPeriodes(stored, defaut)) changements.push('périodes');
    return changements;
  }

  /* ---------- Persistance serveur ----------
     Même interface publique qu'avant (get / cles / periode / actifs / creerPeriode / sauver / reinitialiser / exporterJSON / importerJSON) :
     aucun autre module n'est modifié. Différences : le chargement initial est asynchrone (CT.store.pret) et sauver() envoie l'état à l'API.
     Plus d'expiration à 30 min : les paramètres vivent en base. */
  const toast = (...a) => { if (CT.toast) CT.toast(...a); };
  let versionServeur = 0, minuteur = null, chaine = Promise.resolve(), verifEn = 0;

  function notifier(source) { window.dispatchEvent(new CustomEvent('parametersUpdated', { detail: { source } })); }

  /* Envois sérialisés : jamais deux PUT en parallèle (le second repart avec la version renvoyée par le premier) */
  function envoyer() {
    chaine = chaine.then(async () => {
      try {
        const r = await CT.api.parametres.ecrire(S.get(), versionServeur);
        versionServeur = r.version;
      } catch (e) {
        if (e.status === 409) { toast('Les paramètres ont été modifiés ailleurs : rechargement de la version enregistrée.', 'warn', 6000); await S.recharger(); }
        else toast('Enregistrement impossible (' + e.message + '). Vos dernières modifications ne sont PAS sauvegardées : exportez-les en JSON par précaution.', 'err', 9000);
      }
    });
    return chaine;
  }

  async function charger() {
    try {
      const r = await CT.api.parametres.lire();
      versionServeur = r.version;
      if (!r.vide) {
        etat = r.etat;
        const ch = migrerTout(etat, defauts());
        if (ch.length) { await envoyer(); toast('Mise à jour automatique : ' + ch.join(', '), 'ok', 4000); }
        return;
      }
      // Base vide = première utilisation : on utilise les valeurs par défaut
      etat = defauts();
      await envoyer();
    } catch (e) {
      etat = etat || defauts();
      toast('Serveur injoignable : paramètres par défaut affichés, aucune modification ne sera enregistrée tant que la connexion n\'est pas rétablie.', 'err', 9000);
    }
  }

  const S = (CT.store = {
    /* Promesse résolue quand l'état est chargé depuis la base : les pages l'attendent avant leur init() */
    pret: null,
    get() { if (!etat) etat = defauts(); return etat; },
    cles() { return Object.keys(S.get().periodes).sort(); },
    /* Période demandée ; si absente, hérite de la plus proche antérieure (ou de la première) */
    periode(cle) {
      const p = S.get().periodes;
      if (p[cle]) return { cle, herite: false, objectifs: p[cle].objectifs, regles: p[cle].regles };
      const ks = S.cles();
      const src = ks.filter((k) => k <= cle).pop() || ks[0];
      return { cle: src, herite: true, objectifs: p[src].objectifs, regles: p[src].regles };
    },
    /* Paramètres exploitables pour un mois : si hérités, le calendrier est régénéré (lun→ven) */
    actifs(cle) {
      const p = S.periode(cle);
      if (!p.herite) return p;
      const objectifs = CT.clone(p.objectifs);
      objectifs.periode = cle;
      objectifs.calendrier = { ouvres: CT.date.ouvresDefaut(cle) };
      return { cle, herite: true, source: p.cle, objectifs, regles: p.regles };
    },
    creerPeriode(cle, depuis) {
      const st = S.get();
      const src = depuis && st.periodes[depuis] ? st.periodes[depuis] : st.periodes[S.cles().filter((k) => k < cle).pop() || S.cles()[0]];
      const o = CT.clone(src.objectifs), r = CT.clone(src.regles);
      o.periode = cle; r.periode = cle; o.calendrier = { ouvres: CT.date.ouvresDefaut(cle) };
      st.periodes[cle] = { objectifs: o, regles: r };
      S.sauver('periode');
    },
    /* Recalcul immédiat dans l'interface (évènement), envoi à l'API regroupé (300 ms) pour ne pas poster à chaque frappe */
    sauver(source) {
      S.get().modifie = new Date().toISOString();
      clearTimeout(minuteur);
      minuteur = setTimeout(() => { minuteur = null; envoyer(); }, 300);
      notifier(source || 'save');
    },
    /* Force l'envoi en attente et attend la fin (à appeler avant tout import serveur qui lit ces données) */
    flush() { if (minuteur) { clearTimeout(minuteur); minuteur = null; envoyer(); } return chaine; },
    /* Relit la base (après un import d'objectifs côté serveur, ou si un autre poste a modifié les paramètres) */
    async recharger() {
      const r = await CT.api.parametres.lire();
      versionServeur = r.version;
      if (!r.vide) { etat = r.etat; notifier('serveur'); }
    },
    reinitialiser() { etat = defauts(); S.sauver('reset'); },
    exporterJSON() { return JSON.stringify(S.get(), null, 2); },
    /* Validation légère puis remplacement complet */
    importerJSON(texte) {
      let j; try { j = JSON.parse(texte); } catch (e) { return { ok: false, erreurs: ['Fichier JSON illisible : ' + e.message] }; }
      const err = [];
      if (!j || typeof j !== 'object') err.push('Racine invalide.');
      if (!j.periodes || typeof j.periodes !== 'object' || !Object.keys(j.periodes).length) err.push('« periodes » est absent ou vide.');
      else for (const [k, p] of Object.entries(j.periodes)) {
        if (!/^\d{4}-\d{2}$/.test(k)) err.push('Clé de période invalide : ' + k);
        if (!p.objectifs || !Array.isArray(p.objectifs.equipes)) err.push(k + ' : objectifs.equipes manquant.');
        if (!p.regles || !p.regles.agent || !p.regles.superviseur) err.push(k + ' : regles.agent / regles.superviseur manquants.');
        if (p.objectifs && !(p.objectifs.calendrier && Array.isArray(p.objectifs.calendrier.ouvres))) err.push(k + ' : calendrier.ouvres manquant.');
      }
      if (!j.partenaires || !j.partenaires.alias_login) err.push('« partenaires.alias_login » manquant.');
      if (err.length) return { ok: false, erreurs: err };
      j.version = 1; delete j.expire;
      etat = j; S.sauver('import');
      return { ok: true, erreurs: [] };
    },
  });

  S.pret = charger();

  /* Un autre poste (ou un autre onglet) a pu modifier les paramètres : au retour sur la page, on compare la version et on recharge si besoin */
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || Date.now() - verifEn < 5000 || minuteur) return;
    verifEn = Date.now();
    try { const r = await CT.api.parametres.lire(); if (r.version !== versionServeur && !r.vide) { versionServeur = r.version; etat = r.etat; notifier('serveur'); } } catch (e) { /* hors ligne : on garde l'état courant */ }
  });
})();
