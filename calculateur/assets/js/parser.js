/* ============================================================================
   parser.js — lecture du fichier Excel/CSV « NouvellesSouscriptionOffre » (SheetJS),
   normalisation des lignes et contrôle qualité. 100 % en mémoire (aucun envoi serveur).
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const OBLIGATOIRES = ['STATUS', 'DATE_COMMANDE', 'NOM_OFFRE', 'MONTANT_TOTAL', 'LOGIN_VENDEUR', 'TYPE_CLIENT', 'AGENCE'];
  const STATUTS_CONNUS = ['OK', 'VALIDE'];
  const nom = (s) => String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '_');
  const p2 = (n) => String(n).padStart(2, '0');
  // Autres noms rencontrés pour une même colonne (ex. EVOLUTION_*.xlsx : « NOM_CLIENT ») — identique à CeltiisRowMapper::ALIAS
  const ALIAS = { NOM_CLIENT: 'PRENOM_NOM/RAISON_SOCIALE', RAISON_SOCIALE: 'PRENOM_NOM/RAISON_SOCIALE' };
  const nomColonne = (s) => { const n = nom(s); return ALIAS[n] || n; };
  /* Ligne d'en-têtes = première ligne contenant au moins 3 colonnes obligatoires (−1 si absente) */
  const indexEntete = (aoa) => aoa.findIndex((r) => r && OBLIGATOIRES.filter((c) => r.some((x) => nom(x) === c)).length >= 3);

  /* Date → {ts, jour, heure} ; accepte chaîne ISO, « JJ/MM/AAAA hh:mm », Date JS, numéro de série Excel */
  function lireDate(v) {
    if (v == null || v === '') return null;
    let y, mo, d, H = 0, M = 0, S = 0, m;
    if (v instanceof Date) { y = v.getFullYear(); mo = v.getMonth() + 1; d = v.getDate(); H = v.getHours(); M = v.getMinutes(); S = v.getSeconds(); }
    else if (typeof v === 'number') {
      const c = window.XLSX && XLSX.SSF && XLSX.SSF.parse_date_code(v); if (!c) return null;
      y = c.y; mo = c.m; d = c.d; H = c.H; M = c.M; S = Math.floor(c.S);
    } else {
      const s = String(v).trim();
      if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; H = +(m[4] || 0); M = +(m[5] || 0); S = +(m[6] || 0); }
      else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; H = +(m[4] || 0); M = +(m[5] || 0); S = +(m[6] || 0); }
      else return null;
    }
    if (!(y > 1990 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    return { ts: Date.UTC(y, mo - 1, d, H, M, S), jour: y + '-' + p2(mo) + '-' + p2(d), heure: H };
  }

  /* Date présente dans le nom du fichier : « 12 Octobre », « 12_Octobre », « 12-10-2026 » */
  function dateDuNom(nomFichier) {
    const s = nomFichier.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const mois = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
    let m = new RegExp('(\\d{1,2})[ _.\\-]*(' + mois.join('|') + ')(?:[ _.\\-]*(\\d{4}))?').exec(s);
    if (m) return { jour: +m[1], mois: mois.indexOf(m[2]) + 1, annee: m[3] ? +m[3] : null };
    m = /(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/.exec(s);
    if (m) return { jour: +m[1], mois: +m[2], annee: +m[3] };
    return null;
  }

  CT.parser = {
    lireDate, dateDuNom, OBLIGATOIRES,

    /* Lecture d'un File navigateur, avec progression (0–100) */
    async lireFichier(file, onProgress) {
      const prog = onProgress || (() => {});
      const buf = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onprogress = (e) => e.lengthComputable && prog(Math.round((e.loaded / e.total) * 25), 'Lecture du fichier…');
        fr.onerror = () => rej(new Error('Impossible de lire le fichier.'));
        fr.onload = () => res(fr.result);
        fr.readAsArrayBuffer(file);
      });
      prog(25, 'Décodage Excel…'); await CT.nextFrame();
      const res = await CT.parser.lireBuffer(buf, prog, { csv: /\.csv$/i.test(file.name) });
      res.meta = { nom: file.name, taille: file.size, modifie: file.lastModified, dateNom: dateDuNom(file.name) };
      return res;
    },

    /* Cœur du parseur (utilisable aussi sous Node pour les tests) */
    async lireBuffer(buf, onProgress, opts) {
      const prog = onProgress || (() => {});
      let wb;
      try { wb = XLSX.read(new Uint8Array(buf), Object.assign({ type: 'array' }, opts && opts.csv ? { codepage: 65001 } : {})); }
      catch (e) { throw new Error('Fichier illisible ou corrompu : ce n\'est pas un classeur Excel/CSV valide.'); }
      // Parcours de TOUTES les feuilles : on garde chaque onglet qui porte l'en-tête Celtiis (les TCD et synthèses sont ignorés).
      // Plusieurs onglets de données → lignes concaténées, colonnes réalignées sur l'en-tête du premier (comme l'import serveur).
      const donnees = [];
      for (const nomFeuille of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nomFeuille], { header: 1, raw: true, defval: null, blankrows: true });
        const hi = indexEntete(aoa);
        if (hi >= 0) donnees.push({ nom: nomFeuille, aoa: aoa.slice(hi) });
      }
      if (!donnees.length) {
        throw new Error((wb.SheetNames.length > 1 ? 'Aucune des ' + wb.SheetNames.length + ' feuilles ne contient' : 'Le fichier ne contient pas')
          + ' les données de souscriptions. Colonnes attendues : ' + OBLIGATOIRES.join(', ') + '.');
      }
      const ref = donnees[0].aoa[0].map(nomColonne);
      const aoa = [donnees[0].aoa[0]].concat(...donnees.map((d, i) => {
        if (i === 0) return d.aoa.slice(1);
        const pos = d.aoa[0].map(nomColonne).map((c) => ref.indexOf(c));
        return d.aoa.slice(1).map((r) => { const out = new Array(ref.length).fill(null); (r || []).forEach((v, k) => { if (pos[k] >= 0) out[pos[k]] = v; }); return out; });
      }));
      return CT.parser.depuisAoa(aoa, prog, donnees.map((d) => d.nom).join(' + '));
    },

    /* Normalise un tableau de lignes brutes (en-têtes + données) : utilisé à l'import ET à la restauration de session */
    async depuisAoa(aoa, onProgress, feuille) {
      const prog = onProgress || (() => {});
      prog(45, 'Analyse des colonnes…'); await CT.nextFrame();
      // Ligne d'en-têtes = première ligne contenant au moins 3 colonnes obligatoires
      const hi = indexEntete(aoa);
      if (hi < 0) throw new Error('En-têtes introuvables. Colonnes attendues : ' + OBLIGATOIRES.join(', ') + '.');
      const entetes = aoa[hi].map(nomColonne);
      const manquantes = OBLIGATOIRES.filter((c) => !entetes.includes(c));
      if (manquantes.length) throw new Error('Colonnes manquantes : ' + manquantes.join(', ') + '.');
      const ix = (c) => entetes.indexOf(c);
      const I = { id: ix('ID_CLIENT'), type: ix('TYPE_CLIENT'), nom: ix('PRENOM_NOM/RAISON_SOCIALE'), statut: ix('STATUS'), cmd: ix('DATE_COMMANDE'), msisdn: ix('MSISDN'),
        offre: ix('NOM_OFFRE'), prov: ix('DATE_PROVISIONNING'), upd: ix('DATE_UPDATE'), montant: ix('MONTANT_TOTAL'), agence: ix('AGENCE'), login: ix('LOGIN_VENDEUR'), vendeur: ix('NOM_VENDEUR') };

      const lignes = []; let vides = 0, dateInvalide = 0, incoherentes = 0;
      const corps = aoa.slice(hi + 1);
      for (let k = 0; k < corps.length; k++) {
        const r = corps[k];
        if (!r || r.every((c) => c == null || String(c).trim() === '')) { vides++; continue; }
        const d = lireDate(r[I.cmd]);
        const montant = typeof r[I.montant] === 'number' ? r[I.montant] : parseFloat(String(r[I.montant] == null ? '' : r[I.montant]).replace(/\s/g, '').replace(',', '.')) || 0;
        const login = String(r[I.login] == null ? '' : r[I.login]).trim().toLowerCase();
        const l = {
          n: hi + k + 2, id: r[I.id], typeClient: String(r[I.type] || '').trim().toUpperCase(), client: r[I.nom], statut: String(r[I.statut] || '').trim().toUpperCase(),
          ts: d ? d.ts : null, jour: d ? d.jour : null, heure: d ? d.heure : null, msisdn: r[I.msisdn], offre: String(r[I.offre] || '').trim(),
          montant, agence: String(r[I.agence] || '').trim(), login, loginKey: CT.cleLogin(login), vendeur: r[I.vendeur] == null ? '' : String(r[I.vendeur]).trim(), partenaire: null, segment: null, brut: r,
        };
        if (!d) { dateInvalide++; l.jour = null; }
        else {
          const p = lireDate(r[I.prov]), u = lireDate(r[I.upd]);
          if ((p && p.ts < d.ts - 86400000) || (u && u.ts < d.ts - 86400000)) { incoherentes++; l.incoherent = true; }
        }
        lignes.push(l);
        if (k % 2000 === 1999) { prog(45 + Math.round((k / corps.length) * 45), 'Normalisation des lignes…'); await CT.nextFrame(); }
      }
      prog(92, 'Contrôle qualité…'); await CT.nextFrame();
      return { feuille, entetes, enteteBrut: aoa[hi], lignes, stats: { vides, dateInvalide, incoherentes, lu: corps.length } };
    },

    /* Classe les lignes : segment B2B/B2C selon les règles, partenaire selon la configuration */
    classer(lignes, regles, cfgPartenaires) {
      const res = (cfgPartenaires.regles_agence || []).map((r) => ({ re: new RegExp(r.motif, 'i'), nom: r.partenaire }));
      const alias = cfgPartenaires.alias_login || {};
      for (const l of lignes) {
        l.segment = CT.regles.estB2B(regles, l.typeClient) ? 'B2B' : 'B2C';
        const m = /^(?:pvt|pms|stg)[_-]([a-z0-9]+)[_-]/.exec(l.login);
        if (m) { l.partenaire = alias[m[1]] || m[1].toUpperCase(); l.viaLogin = true; }
        else { const hit = res.find((x) => x.re.test(l.agence)); l.partenaire = hit ? hit.nom : (cfgPartenaires.defaut || 'AUTRES'); l.viaLogin = false; }
      }
      return lignes;
    },

    /* Rapport qualité : [{id, label, count, niveau, detail}] + drapeau bloquant */
    controleQualite(res, regles) {
      const { lignes, stats } = res; const out = [];
      const add = (id, label, count, niveau, detail) => out.push({ id, label, count, niveau: count === 0 && niveau !== 'info' ? 'ok' : niveau, detail: detail || '' });
      out.push({ id: 'lu', label: 'Lignes lues', count: stats.lu, niveau: 'ok', detail: CT.fmt.int(lignes.length) + ' lignes exploitables, ' + stats.vides + ' ligne(s) vide(s) ignorée(s).' });
      add('vides', 'Lignes vides', stats.vides, 'warn', 'Ignorées automatiquement.');
      const vu = new Map(); let doublons = 0;
      lignes.forEach((l) => { const k = l.id + '|' + l.msisdn; if (vu.has(k)) { doublons++; } else vu.set(k, 1); });
      add('doublons', 'Doublons (ID_CLIENT + MSISDN)', doublons, 'warn', 'Les doublons sont conservés ; vérifiez la source.');
      const inconnus = {}; lignes.forEach((l) => { if (!STATUTS_CONNUS.includes(l.statut)) inconnus[l.statut || '(vide)'] = (inconnus[l.statut || '(vide)'] || 0) + 1; });
      const nInc = Object.values(inconnus).reduce((a, b) => a + b, 0);
      add('statuts', 'STATUS inconnus (hors OK / VALIDE)', nInc, 'warn', Object.entries(inconnus).map(([k, v]) => k + ' ×' + v).join(', '));
      add('zero', 'MONTANT_TOTAL = 0', lignes.filter((l) => l.montant === 0).length, 'warn', 'Inclus dans le volume, sans effet sur le CA.');
      const seuil = regles.seuil_montant_atypique || 1e6;
      const atyp = lignes.filter((l) => l.montant > seuil);
      add('atypiques', 'Montants atypiques (> ' + CT.fmt.fcfa(seuil) + ')', atyp.length, 'warn', atyp.length ? 'Exclus du CA par défaut : ' + atyp.map((l) => CT.fmt.fcfa(l.montant)).join(', ') : '');
      add('dates', 'Dates de commande invalides', stats.dateInvalide, 'err', 'Ces lignes sont exclues des calculs par jour.');
      add('incoh', 'Dates incohérentes (provisioning/mise à jour avant la commande)', stats.incoherentes, 'warn');
      const sansLogin = lignes.filter((l) => !l.login).length;
      add('login', 'Lignes sans LOGIN_VENDEUR', sansLogin, 'warn');
      const nonPart = lignes.filter((l) => l.viaLogin === false).length;
      if (nonPart) out.push({ id: 'part', label: 'Logins sans nom de partenaire', count: nonPart, niveau: 'info', detail: 'Rattachés par agence (POP&SHOP, etc.) ou « AUTRES » — modifiable dans Paramètres › Partenaires.' });
      const jours = lignes.filter((l) => l.jour).map((l) => l.jour).sort();
      return { items: out, bloquant: !lignes.length || stats.dateInvalide === lignes.length, du: jours[0] || null, au: jours[jours.length - 1] || null };
    },
  };
})();
