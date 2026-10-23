/* ============================================================================
   api.js — client de l'API Laravel (fetch). Toutes les données sont stockées en base MySQL.
   Base d'URL : /api par défaut (front servi par Laravel, même origine → ni CORS ni CSRF).
   Autre domaine : définir window.CT_API_BASE = 'https://api.exemple.com/api' avant ce script.
   Authentification : session PHP des administrateurs (cookie, voir src/Auth.php) ; 401 → page de connexion.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  // Par défaut : <racine de l'app>/api/index.php?route=…, déduit de l'URL de ce script (<racine>/calculateur/assets/js/api.js).
  // Cette forme marche partout : sous-dossier, serveur qui ignore les .htaccess (pas de réécriture → /api/parametres = 404), PATH_INFO désactivé.
  // window.CT_API_BASE (ex. 'https://api.exemple.com/api') : URL « propres » base + chemin, réécriture obligatoire côté serveur.
  const PERSO = window.CT_API_BASE ? String(window.CT_API_BASE).replace(/\/$/, '') : null;
  const BASE = PERSO || (document.currentScript ? new URL('../../../api/index.php', document.currentScript.src).pathname : '/api/index.php');

  const premiereErreur = (errs) => { const k = errs && Object.keys(errs)[0]; return k ? [].concat(errs[k])[0] : null; };

  async function requete(chemin, opts) {
    const { method = 'GET', json, form, params } = opts || {};
    const q = new URLSearchParams();
    if (!PERSO) q.append('route', chemin.replace(/^\//, ''));
    if (params) {
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.append(k, Array.isArray(v) ? v.join(',') : v); });
    }
    const s = q.toString(), url = (PERSO ? BASE + chemin : BASE) + (s ? '?' + s : '');
    const init = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (window.CT_API_TOKEN) init.headers.Authorization = 'Bearer ' + window.CT_API_TOKEN;
    if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
    else if (form) init.body = form; // FormData : le navigateur fixe lui-même le Content-Type multipart

    let rep;
    try { rep = await fetch(url, init); }
    catch (e) { const err = new Error('Serveur injoignable'); err.reseau = true; throw err; }
    let data = null; try { data = await rep.json(); } catch (e) { /* corps vide ou non JSON */ }
    // Session expirée ou absente : retour à la page de connexion, puis à la page en cours une fois reconnecté
    if (rep.status === 401) {
      const page = location.pathname.split('/').pop() || 'index.php';
      location.href = 'connexion.php?expiree=1&retour=' + encodeURIComponent((/^(index|parametres)\.php$/.test(page) ? page : 'index.php') + location.hash);
      const err = new Error('Session expirée : reconnexion…'); err.status = 401; throw err;
    }
    if (!rep.ok) {
      // 502/503/504 sans réponse JSON : ce n'est pas l'application mais l'hébergeur qui a coupé la requête
      const coupe = [502, 503, 504].includes(rep.status) ? 'L\'hébergeur a interrompu le traitement (erreur ' + rep.status + ' : durée ou mémoire dépassée).' : null;
      const err = new Error((data && (premiereErreur(data.errors) || data.message)) || coupe || 'Erreur serveur (' + rep.status + ')');
      err.status = rep.status; err.data = data; throw err;
    }
    return data;
  }

  const fd = (champs) => { const f = new FormData(); Object.entries(champs).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== false) f.append(k, v === true ? '1' : v); }); return f; };

  /* Pied du menu : jusqu'à quand vont les données et quand a eu lieu le dernier import (point rouge si le serveur ne répond pas) */
  let dernier = null;
  const depuis = (iso) => { const m = (Date.now() - new Date(iso).getTime()) / 60000; return m < 1 ? 'à l\'instant' : m < 60 ? 'il y a ' + Math.round(m) + ' min' : m < 1440 ? 'il y a ' + Math.round(m / 60) + ' h' : m < 2880 ? 'hier' : 'il y a ' + Math.round(m / 1440) + ' jours'; };
  function statut(d, err) {
    const el = document.querySelector('.db-status'); if (!el) return;
    if (d !== undefined) dernier = { d, err };
    const x = dernier || {}, imp = x.d && x.d.dernier_import;
    el.classList.toggle('ko', !!x.err);
    el.classList.toggle('vieux', !!(imp && Date.now() - new Date(imp.date).getTime() > 2 * 864e5));   // plus de 2 jours sans import
    el.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="db-txt">' + (x.err ? '<b>Serveur injoignable</b><small>Réessayez dans un instant</small>'
      : !x.d || !x.d.au ? '<b>Aucune donnée</b><small>Importez un fichier</small>'
      : '<b>Données au ' + CT.date.court(x.d.au) + '</b><small>' + (imp ? 'Dernier import ' + depuis(imp.date) : 'Aucun import') + '</small>') + '</span>';
    el.title = imp ? 'Dernier fichier importé : ' + imp.nom : '';
  }
  // Page Paramètres (pas de tableau de bord qui charge les données) : on interroge une fois ; l'heure relative se met à jour chaque minute
  document.addEventListener('DOMContentLoaded', () => { if (!document.getElementById('view-dashboard') && document.querySelector('.db-status')) CT.api.souscriptions.periodes().catch(() => {}); });
  setInterval(() => { if (dernier) statut(); }, 60000);

  CT.api = {
    requete,
    /* Paramètres (objectifs, règles, partenaires) : stockés en base MySQL */
    parametres: {
      lire: () => requete('/parametres'),
      ecrire: (etat, baseVersion) => requete('/parametres', { method: 'PUT', json: { etat, base_version: baseVersion } }),
    },
    /* Objectifs mensuels */
    objectifs: {
      lister: (filtres) => requete('/objectifs', { params: filtres }),                       // {mois, niveau, equipe}
      importer: (fichier, mois, miseAJour) => requete('/imports/objectifs', { method: 'POST', form: fd({ fichier, mois, mise_a_jour: !!miseAJour }) }),
      confirmer: (token) => requete('/imports/objectifs/confirmer', { method: 'POST', json: { token } }),
    },
    /* Vue d'ensemble de toute la base (tableau de bord du Directeur) */
    synthese: (periode) => requete('/synthese', { params: periode }),   // periode {du, au} ; sans : année en cours
    /* Données Celtiis (souscriptions) : remplace IndexedDB « ct_session » */
    souscriptions: {
      importer: (fichier, forcer) => requete('/imports/souscriptions', { method: 'POST', form: fd({ fichier, forcer: !!forcer }) }),
      periodes: () => requete('/souscriptions/periodes').then((d) => { statut(d); return d; }, (e) => { statut(null, e); throw e; }),   // met aussi à jour le pied du menu
      lister: (filtres) => requete('/souscriptions', { params: filtres }),                   // {mois, du, au, statut, type_client, agence, login, offre, page, per_page}
      aoa: (filtres) => requete('/souscriptions', { params: Object.assign({}, filtres, { format: 'aoa' }) }),
      ajouter: (ligne) => requete('/souscriptions', { method: 'POST', json: ligne }),        // 201 créée · 409 existe déjà
    },
  };
})();
