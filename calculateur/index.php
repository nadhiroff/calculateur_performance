<?php
// Page réservée aux administrateurs connectés (sinon redirection vers connexion.php)
require dirname(__DIR__).'/vendor/autoload.php';
$admin = App\Auth::exiger('index.php');
$jeton = App\Auth::jeton();
$h = static fn (?string $s): string => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
// Groupes du menu laissés ouverts (session serveur) ; jamais modifiés : Facturation ouvert par défaut
$menuOuvert = App\Auth::menuAdmin() ?? ['facturation'];
$ouvert = static fn (string $g): string => in_array($g, $menuOuvert, true) ? ' open' : '';
?>
<!DOCTYPE html>
<html lang="fr" data-theme="auto">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <title>POWERGZ</title>
  <meta name="description" content="POWERGZ : tableau de bord des souscriptions, point du jour et performance des partenaires.">
  <link rel="icon" type="image/png" href="assets/img/logoRGZ-64.png?v=2">
  <link rel="shortcut icon" href="favicon.ico?v=2">
  <link rel="apple-touch-icon" href="assets/img/logoRGZ-180.png?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
  <link rel="stylesheet" href="assets/css/design-system.css?v=20261021-15">
  <link rel="stylesheet" href="assets/css/components.css?v=20261104-x2">
  <link rel="stylesheet" href="assets/css/dashboard.css?v=20261105-p1">
  <link rel="stylesheet" href="assets/css/print.css?v=20261021-15">
  <style>/* Page Paramètres (reprise de parametres.php, limitée à #view-parametres) */

    #view-parametres #tabs { display: none; }   /* sections choisies dans le sidebar (sous-menus Paramètres) */
    #view-parametres .param-bar { display: flex; gap: var(--sp-3); flex-wrap: wrap; align-items: flex-end; margin-bottom: var(--sp-5); padding: var(--sp-4); }
    #view-parametres .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(44px, 1fr)); gap: 6px; max-width: 420px; }
    #view-parametres .cal-grid .dow { font-size: var(--fs-12); color: var(--text-3); text-align: center; font-weight: 600; }
    #view-parametres .cal-day { min-height: 44px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-weight: 600; transition: background var(--t-fast), border-color var(--t-fast); }
    #view-parametres .cal-day[aria-pressed="true"] { background: var(--primary-600); color: #fff; border-color: var(--primary-600); }
    #view-parametres .cal-day:hover { border-color: var(--primary-600); }
    #view-parametres td[role="gridcell"] { cursor: cell; } td[role="gridcell"]:hover { background: var(--primary-soft); }
    #view-parametres td .input { min-width: 90px; }
    #view-parametres .status { font-size: var(--fs-12); color: var(--text-3); }
    #view-parametres .form-grid { display: grid; gap: var(--sp-4); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    #view-parametres .hint { font-size: var(--fs-12); color: var(--text-3); }
    /* Fenêtre « Ajouter des objectifs » : champs plus étroits (3 par ligne sur ordinateur, 1 sur téléphone) */
    dialog.modal .form-grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--sp-3); }
    dialog.modal .stack { gap: var(--sp-4); padding-bottom: var(--sp-2); }
    dialog.modal .form-grid > * { min-width: 0; } dialog.modal .field .input, dialog.modal .field .select { width: 100%; min-width: 0; box-sizing: border-box; }
    #ao-mois { background: var(--surface-2); font-weight: 700; }
    @media (max-width: 480px) { dialog.modal .modal-foot .btn { flex: 1 1 100%; } }
    @media (max-width: 480px) {
      #view-parametres .cal-grid { grid-template-columns: repeat(7, minmax(36px, 1fr)); gap: 4px; max-width: 100%; }
      #view-parametres .cal-day { min-height: 36px; font-size: 13px; }
      #view-parametres .cal-grid .dow { font-size: 11px; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Aller au contenu</a>

  <div class="shell">
    <!-- Sidebar : navigation principale (sur mobile, tiroir ouvert par #mobile-menu-btn) -->
    <nav class="nav-tabs sidebar" id="nav" aria-label="Navigation principale">
      <a class="brand" href="#dashboard" aria-label="POWERGZ — accueil"><img src="assets/img/logoRGZ-128.png" alt="" width="36" height="36"><span class="brand-txt">POWERGZ</span></a>
      <div class="nav-section">Pilotage</div>
      <a href="#dashboard" data-vue="dashboard"><i class="fa-solid fa-chart-pie" aria-hidden="true"></i>Tableau de bord</a>
      <details class="nav-group" data-groupe="rgz"<?= $ouvert('rgz') ?>>
        <summary><i class="fa-solid fa-star" aria-hidden="true"></i>Tableau de bord RGZ</summary>
        <a href="#rgz/apercu" data-sous="rgz/apercu"><i class="fa-solid fa-star" aria-hidden="true"></i>Vue d'ensemble</a>
        <a href="#rgz/evolution" data-sous="rgz/evolution"><i class="fa-solid fa-chart-line" aria-hidden="true"></i>Progression et évolution</a>
        <a href="#rgz/alertes" data-sous="rgz/alertes"><i class="fa-solid fa-bell" aria-hidden="true"></i>Alertes et recommandations</a>
      </details>
      <details class="nav-group" data-groupe="pointjour"<?= $ouvert('pointjour') ?>>
        <summary><i class="fa-solid fa-calendar-day" aria-hidden="true"></i>Point du jour</summary>
        <a href="#point-du-jour/resume" data-sous="pointjour/resume"><i class="fa-solid fa-house" aria-hidden="true"></i>Résumé</a>
        <a href="#point-du-jour/equipes" data-sous="pointjour/equipes"><i class="fa-solid fa-people-group" aria-hidden="true"></i>Équipes</a>
        <a href="#point-du-jour/vendeurs" data-sous="pointjour/vendeurs"><i class="fa-solid fa-user-tie" aria-hidden="true"></i>Vendeurs</a>
        <a href="#point-du-jour/primes" data-sous="pointjour/primes"><i class="fa-solid fa-sack-dollar" aria-hidden="true"></i>Commissions &amp; primes</a>
        <a href="#point-du-jour/objectifs" data-sous="pointjour/objectifs"><i class="fa-solid fa-bullseye" aria-hidden="true"></i>Objectifs à suivre</a>
        <a href="#point-du-jour/attention" data-sous="pointjour/attention"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>À surveiller</a>
      </details>
      <details class="nav-group" data-groupe="perf"<?= $ouvert('perf') ?>>
        <summary><i class="fa-solid fa-ranking-star" aria-hidden="true"></i>Performance partenaires</summary>
        <a href="#performance/apercu" data-sous="perf/apercu"><i class="fa-solid fa-star" aria-hidden="true"></i>RGZ en bref</a>
        <a href="#performance/b2b" data-sous="perf/b2b"><i class="fa-solid fa-building" aria-hidden="true"></i>Ventes B2B</a>
        <a href="#performance/b2c" data-sous="perf/b2c"><i class="fa-solid fa-house-user" aria-hidden="true"></i>Ventes B2C</a>
        <a href="#performance/commissions" data-sous="perf/commissions"><i class="fa-solid fa-sack-dollar" aria-hidden="true"></i>Commissions &amp; primes</a>
        <a href="#performance/objectifs" data-sous="perf/objectifs"><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i>Atteinte des objectifs</a>
        <a href="#performance/autres" data-sous="perf/autres"><i class="fa-solid fa-handshake" aria-hidden="true"></i>Autres partenaires</a>
      </details>
      <div class="nav-section">Analyse</div>
      <a href="#comparaisons" data-vue="comparaisons"><i class="fa-solid fa-code-compare" aria-hidden="true"></i>Comparaisons</a>
      <details class="nav-group" data-groupe="previsions"<?= $ouvert('previsions') ?>>
        <summary><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>Prévisions</summary>
        <a href="#previsions/projection" data-sous="previsions/projection"><i class="fa-solid fa-calendar" aria-hidden="true"></i>Projection mensuelle</a>
        <a href="#previsions/parametres" data-sous="previsions/parametres"><i class="fa-solid fa-sliders" aria-hidden="true"></i>Paramètres par mois</a>
        <a href="#previsions/scenarios" data-sous="previsions/scenarios"><i class="fa-solid fa-table" aria-hidden="true"></i>Comparaison des scénarios</a>
        <a href="#previsions/agents" data-sous="previsions/agents"><i class="fa-solid fa-people-group" aria-hidden="true"></i>Contribution par agent</a>
      </details>
      <div class="nav-section">Challenge</div>
      <a href="#challenge-login" data-vue="challogin"><i class="fa-solid fa-user-astronaut" aria-hidden="true"></i>Challenge login</a>
      <a href="#challenge-equipe" data-vue="chalequipe"><i class="fa-solid fa-people-group" aria-hidden="true"></i>Challenge équipe</a>
      <!-- Menu « Facturation » et ses sous-menus -->
      <details class="nav-group" data-groupe="facturation"<?= $ouvert('facturation') ?>>
        <summary><i class="fa-solid fa-file-invoice-dollar" aria-hidden="true"></i>Facturation</summary>
        <a href="#facturation" data-vue="factdash"><i class="fa-solid fa-gauge-high" aria-hidden="true"></i>Résumé</a>
        <a href="#facturation-b2b" data-vue="factb2b"><i class="fa-solid fa-building" aria-hidden="true"></i>Facture B2B</a>
        <a href="#facturation-b2c" data-vue="factb2c"><i class="fa-solid fa-house-signal" aria-hidden="true"></i>Facture B2C</a>
        <a href="#facturation-evolution" data-vue="factevo"><i class="fa-solid fa-chart-line" aria-hidden="true"></i>Évolution</a>
        <a href="#facturation-performance" data-vue="factperf"><i class="fa-solid fa-ranking-star" aria-hidden="true"></i>Performance agents</a>
        <a href="#facturation-recommandations" data-vue="factreco"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i>Recommandations</a>
        <a href="#point-financier" data-vue="finance"><i class="fa-solid fa-money-bill-trend-up" aria-hidden="true"></i>Point financier par login</a>
        <a href="#reports" data-vue="reports"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>Reports</a>
      </details>
      <div class="nav-section">Configuration</div>
      <details class="nav-group" data-groupe="parametres"<?= $ouvert('parametres') ?>>
        <summary><i class="fa-solid fa-sliders" aria-hidden="true"></i>Paramètres</summary>
        <a href="#parametres/obj" data-sous="parametres/obj"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>Saisie des objectifs</a>
        <a href="#parametres/regles" data-sous="parametres/regles"><i class="fa-solid fa-scale-balanced" aria-hidden="true"></i>Règles de motivation</a>
        <a href="#parametres/part" data-sous="parametres/part"><i class="fa-solid fa-handshake" aria-hidden="true"></i>Partenaires</a>
        <a href="#parametres/users" data-sous="parametres/users"><i class="fa-solid fa-user-lock" aria-hidden="true"></i>Utilisateurs</a>
        <a href="#parametres/save" data-sous="parametres/save"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>Sauvegarde</a>
      </details>
      <div class="nav-user" data-inactivite="<?= App\Auth::inactiviteAdmin() ?>">
        <span class="nav-user-ic" aria-hidden="true"><i class="fa-solid fa-user-shield"></i></span>
        <span class="nav-user-txt"><b><?= $h($admin['nom'] ?: 'Administrateur') ?></b><small><?= $h($admin['email']) ?></small></span>
        <form method="post" action="deconnexion.php"><input type="hidden" name="csrf" value="<?= $h($jeton) ?>"><button type="submit" class="nav-logout" title="Se déconnecter" aria-label="Se déconnecter"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i></button></form>
      </div>
      <div class="nav-foot">
        <span class="db-status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span class="db-txt"><b>Chargement…</b></span></span>
        <button type="button" id="theme-btn" aria-label="Changer de thème"></button>
      </div>
    </nav>
    <div id="mobile-overlay" aria-hidden="true"></div>

    <div class="main-col">
      <header class="app-header" id="app-header">
        <div class="container">
          <div class="topbar">
            <button type="button" id="mobile-menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="nav"><i class="fa-solid fa-bars"></i></button>
            <a class="topbar-brand" href="#dashboard" aria-label="Accueil"><img src="assets/img/logoRGZ-128.png" alt="" width="30" height="30"></a>
            <div class="crumbs"><span>POWERGZ</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><b id="share-ctx">Tableau de bord</b></div>
            <!-- À droite du fil d'Ariane : dates, réinitialisation, période (3 derniers mois en base + autre période), vue des graphiques -->
          <div class="date-filters filtres-ligne no-print" id="global-date-filters" hidden>
            <div class="field"><label for="global-date-debut">Du</label><input class="input input-sm" type="date" id="global-date-debut" title="Date de début"></div>
            <div class="field"><label for="global-date-fin">Au</label><input class="input input-sm" type="date" id="global-date-fin" title="Date de fin"></div>
            <button class="btn btn-ghost btn-sm btn-icone" id="reset-filters" type="button" title="Réinitialiser : dernier mois présent en base" aria-label="Réinitialiser la période"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i></button>
            <div class="periode-barre" id="periode-barre" hidden>
              <div class="pb-groupe" role="group" aria-label="Période" title="Période"><span class="pb-lib">Période</span><span class="pb-btns" id="pb-periodes"></span>
                <label class="sr-only" for="periode-rapide">Autre période</label><select class="select input-sm pb-select" id="periode-rapide" title="Autre mois ou année présents en base"><option value="">Autre période…</option></select></div>
              <div class="pb-groupe" id="pb-vue" role="group" aria-label="Vue des graphiques" title="Vue des graphiques : par jour, semaine ou mois"><span class="pb-lib">Vue</span><span class="pb-btns">
                <button type="button" class="pb-btn" data-vue-gran="jour">Jour</button><button type="button" class="pb-btn" data-vue-gran="semaine">Semaine</button><button type="button" class="pb-btn" data-vue-gran="mois">Mois</button></span></div>
            </div>
            </div>
            <!-- Pages Facturation : à la place des dates, les mois dont un fichier « POINT VENTES » a été importé (le dernier par défaut) -->
            <div class="date-filters filtres-ligne no-print" id="fact-periode" hidden>
              <div class="periode-barre"><div class="pb-groupe" role="group" aria-label="Mois facturé" title="Mois facturé : mois dont le fichier de facture a été importé">
                <span class="pb-lib">Mois facturé</span><span class="pb-btns" id="fp-mois"></span>
                <label class="sr-only" for="fp-autre">Autre mois facturé</label><select class="select input-sm pb-select" id="fp-autre" title="Autre mois facturé, classé par année"><option value="">Autre mois…</option></select></div></div>
            </div>
          </div>
          <!-- Barre d'export / partage : agit sur la vue affichée -->
          <div class="share-row" id="sharebar" role="toolbar" aria-label="Téléchargement et partage">
            <span class="ctx" aria-hidden="true">Exporter</span>
            <button class="btn btn-secondary btn-sm" data-action="xlsx" type="button" disabled><i class="fa-solid fa-file-excel" aria-hidden="true"></i>Excel</button>
            <button class="btn btn-secondary btn-sm" data-action="pdf" type="button" disabled><i class="fa-solid fa-file-pdf" aria-hidden="true"></i>PDF</button>
            <button class="btn btn-secondary btn-sm" data-action="csv" type="button" disabled><i class="fa-solid fa-file-csv" aria-hidden="true"></i>CSV</button>
            <span class="sep" aria-hidden="true"></span>
            <button class="btn btn-wa btn-sm" data-action="whatsapp" type="button" disabled><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp</button>
            <button class="btn btn-secondary btn-sm" data-action="gmail" type="button" disabled><i class="fa-solid fa-envelope" aria-hidden="true"></i>Gmail</button>
            <button class="btn btn-secondary btn-sm" data-action="outlook" type="button" disabled><i class="fa-solid fa-envelope-open-text" aria-hidden="true"></i>Outlook</button>
            <button class="btn btn-secondary btn-sm" data-action="natif" type="button" disabled><i class="fa-solid fa-share-nodes" aria-hidden="true"></i>Partager</button>
            <label class="sr-only" for="pj-format">Format de la pièce jointe</label>
            <select class="select input-sm" id="pj-format" style="width:auto" disabled title="Format du fichier proposé par le partage natif (mobile). Gmail/Outlook partagent le résumé en ligne."><option value="xlsx">Partage natif : Excel</option><option value="pdf">Partage natif : PDF</option></select>
            <span class="sep" aria-hidden="true"></span>
            <button class="btn btn-ghost btn-sm" data-action="copier" type="button" disabled><i class="fa-solid fa-copy" aria-hidden="true"></i>Copier le résumé</button>
            <button class="btn btn-ghost btn-sm" data-action="imprimer" type="button" disabled><i class="fa-solid fa-print" aria-hidden="true"></i>Imprimer</button>
            <button class="btn btn-ghost btn-sm" data-action="global" type="button" disabled title="Un classeur Excel : données brutes, KPI, point du jour, performance, objectifs"><i class="fa-solid fa-layer-group" aria-hidden="true"></i>Export global</button>
          </div>
          <p class="mini-cap no-print" id="filter-status" aria-live="polite"></p>
        </div>
      </header>

      <main id="main" class="container">
        <!-- ===== TABLEAU DE BORD ===== -->
        <section id="view-dashboard" class="view active" aria-labelledby="h-dash">
          <div class="page-title"><div><span class="eyebrow">Pilotage</span><h1 id="h-dash">Tableau de bord</h1><p id="dash-sub"></p></div></div>
          <!-- Vue d'ensemble de toute la base (rendue par CT.dashboard.synthese) -->
          <section id="synthese" class="overview" aria-label="Vue d'ensemble de la plateforme" hidden></section>
          <div id="import-zone" style="margin-bottom:24px"></div>
          <div id="dash-content" hidden></div>
        </section>

        <!-- ===== TABLEAU DE BORD RGZ (partenaire prioritaire seul) ===== -->
        <section id="view-rgz" class="view" aria-labelledby="h-rgz">
          <div class="page-title"><div><span class="eyebrow">Pilotage</span><h1 id="h-rgz">Tableau de bord RGZ</h1><p id="rgz-sub"></p></div></div>
          <div class="card empty view-loading" aria-busy="true"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><h3>Chargement des données…</h3></div>
          <div class="card empty" id="rgz-empty" hidden><i class="fa-solid fa-star" aria-hidden="true"></i><h3>Aucune donnée pour le moment</h3><p>Importez le fichier de souscriptions pour voir le tableau de bord RGZ.</p><p style="margin-top:20px"><button class="btn btn-primary" type="button" data-goto><i class="fa-solid fa-file-import" aria-hidden="true"></i>Aller à l'import</button></p></div>
          <div id="rgz-content" hidden></div>
          <!-- Indicateurs, objectifs, évolution, alertes (analyse.js) -->
          <div id="rgz-plus"></div>
        </section>

        <!-- ===== POINT DU JOUR ===== -->
        <section id="view-pointjour" class="view" aria-labelledby="h-pj">
          <div class="page-title"><div><span class="eyebrow">Pilotage</span><h1 id="h-pj">Point du jour</h1><p id="pj-sub"></p></div></div>
          <div class="card empty view-loading" aria-busy="true"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><h3>Chargement des données…</h3></div>
          <div class="card empty" id="pj-empty" hidden><i class="fa-solid fa-calendar-day" aria-hidden="true"></i><h3>Aucune donnée pour le moment</h3><p>Importez le fichier de souscriptions pour générer automatiquement le point du jour.</p><p style="margin-top:20px"><button class="btn btn-primary" type="button" data-goto><i class="fa-solid fa-file-import" aria-hidden="true"></i>Aller à l'import</button></p></div>
          <div id="pj-content" hidden></div>
        </section>

        <!-- ===== PERFORMANCE PARTENAIRES ===== -->
        <section id="view-perf" class="view" aria-labelledby="h-perf">
          <div class="page-title"><div><span class="eyebrow">Pilotage</span><h1 id="h-perf">Performance</h1><p id="perf-sub"></p></div></div>
          <div class="card empty view-loading" aria-busy="true"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><h3>Chargement des données…</h3></div>
          <div class="card empty" id="perf-empty" hidden><i class="fa-solid fa-ranking-star" aria-hidden="true"></i><h3>Aucune donnée pour le moment</h3><p>Importez le fichier de souscriptions pour comparer les partenaires, le plan de motivation et les objectifs.</p><p style="margin-top:20px"><button class="btn btn-primary" type="button" data-goto><i class="fa-solid fa-file-import" aria-hidden="true"></i>Aller à l'import</button></p></div>
          <div id="perf-content" hidden></div>
        </section>

        <!-- ===== CHALLENGE LOGIN ===== -->
        <section id="view-challogin" class="view" aria-labelledby="h-challogin">
          <div class="page-title"><div><span class="eyebrow">Challenge</span><h1 id="h-challogin">Challenge login</h1></div></div>
          <div id="challogin-content"></div>
        </section>
        <!-- ===== CHALLENGE ÉQUIPE ===== -->
        <section id="view-chalequipe" class="view" aria-labelledby="h-chalequipe">
          <div class="page-title"><div><span class="eyebrow">Challenge</span><h1 id="h-chalequipe">Challenge équipe</h1></div></div>
          <div id="chalequipe-content"></div>
        </section>
        <!-- ===== FACTURATION B2C ===== -->
        <section id="view-factb2c" class="view" aria-labelledby="h-factb2c">
          <div class="page-title"><div><span class="eyebrow">Facturation Celtiis</span><h1 id="h-factb2c">Facturation B2C</h1></div></div>
          <div id="factb2c-content"></div>
        </section>
        <!-- ===== FACTURATION B2B ===== -->
        <section id="view-factb2b" class="view" aria-labelledby="h-factb2b">
          <div class="page-title"><div><span class="eyebrow">Facturation Celtiis</span><h1 id="h-factb2b">Facturation B2B</h1></div></div>
          <div id="factb2b-content"></div>
        </section>
        <!-- ===== POINT FINANCIER PAR LOGIN ===== -->
        <section id="view-finance" class="view" aria-labelledby="h-finance">
          <div class="page-title"><div><span class="eyebrow">Facturation Celtiis</span><h1 id="h-finance">Point financier par login</h1></div></div>
          <div id="finance-content"></div>
        </section>
        <!-- ===== REPORTS ===== -->
        <section id="view-reports" class="view" aria-labelledby="h-reports">
          <div class="page-title"><div><span class="eyebrow">Facturation Celtiis</span><h1 id="h-reports">Reports</h1></div></div>
          <div id="reports-content"></div>
        </section>
        <!-- ===== FACTURATION : TABLEAU DE BORD, ÉVOLUTION, PERFORMANCE AGENTS, RECOMMANDATIONS (facturation.js) ===== -->
        <section id="view-factdash" class="view" aria-labelledby="h-factdash">
          <div class="page-title"><div><span class="eyebrow">Facturation Celtiis</span><h1 id="h-factdash">Résumé</h1></div></div>
          <div id="factdash-content"></div>
        </section>
        <section id="view-factevo" class="view" aria-labelledby="h-factevo">
          <div class="page-title"><div><span class="eyebrow">Facturation Celtiis</span><h1 id="h-factevo">Évolution de la facturation</h1></div></div>
          <div id="factevo-content"></div>
        </section>
        <section id="view-factperf" class="view" aria-labelledby="h-factperf">
          <div class="page-title"><div><span class="eyebrow">Facturation Celtiis</span><h1 id="h-factperf">Performance agents</h1></div></div>
          <div id="factperf-content"></div>
        </section>
        <section id="view-factreco" class="view" aria-labelledby="h-factreco">
          <div class="page-title"><div><span class="eyebrow">Facturation Celtiis</span><h1 id="h-factreco">Recommandations</h1></div></div>
          <div id="factreco-content"></div>
        </section>
        <!-- ===== PARAMÈTRES (parametres.js) : page de l'application, sans rechargement ===== -->
        <section id="view-parametres" class="view" aria-labelledby="h-parametres">
          <div class="page-title"><div><span class="eyebrow">Configuration</span><h1 id="h-parametres">Paramètres</h1><p>Objectifs, règles de motivation, partenaires et codes d'accès des commerciaux, modifiables sans toucher au code. <span class="status" id="statut" aria-live="polite"></span></p></div></div>
          <div class="tabs" role="tablist" aria-label="Sections des paramètres" id="tabs">
            <button role="tab" id="tab-obj" aria-controls="p-obj" aria-selected="true">Objectifs</button>
            <button role="tab" id="tab-regles" aria-controls="p-regles" aria-selected="false">Règles de motivation</button>
            <button role="tab" id="tab-part" aria-controls="p-part" aria-selected="false">Partenaires</button>
            <button role="tab" id="tab-users" aria-controls="p-users" aria-selected="false">Utilisateurs</button>
            <button role="tab" id="tab-save" aria-controls="p-save" aria-selected="false">Sauvegarde</button>
          </div>
          <div class="param-bar card" id="periode-bar" hidden>
            <div class="field"><label for="sel-periode">Période</label><select class="select" id="sel-periode"></select></div>
            <button class="btn btn-primary" id="btn-nouveau-mois" type="button"><i class="fa-solid fa-plus" aria-hidden="true"></i>Nouveau mois</button>
            <button class="btn btn-secondary" id="btn-dup-annee" type="button"><i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>Dupliquer l'année</button>
            <button class="btn btn-ghost" id="btn-reset-periode" type="button"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>Réinitialiser ce mois</button>
            <button class="btn btn-danger" id="btn-suppr-mois" type="button" style="margin-left:auto"><i class="fa-solid fa-trash" aria-hidden="true"></i>Supprimer ce mois</button>
          </div>
          <section id="p-obj" role="tabpanel" aria-labelledby="tab-obj" hidden></section>
          <section id="p-regles" role="tabpanel" aria-labelledby="tab-regles" hidden></section>
          <section id="p-part" role="tabpanel" aria-labelledby="tab-part" hidden></section>
          <section id="p-users" role="tabpanel" aria-labelledby="tab-users" hidden></section>
          <section id="p-save" role="tabpanel" aria-labelledby="tab-save" hidden></section>
      
        </section>
        <!-- ===== ANALYSE : COMPARAISONS, PRÉVISIONS (analyse.js) ===== -->
        <section id="view-comparaisons" class="view" aria-labelledby="h-comparaisons">
          <div class="page-title"><div><span class="eyebrow">Analyse</span><h1 id="h-comparaisons">Comparaisons</h1></div></div>
          <div id="comparaisons-content"></div>
        </section>
        <section id="view-previsions" class="view" aria-labelledby="h-previsions">
          <div class="page-title"><div><span class="eyebrow">Analyse</span><h1 id="h-previsions">Prévisions</h1></div></div>
          <div id="previsions-content"></div>
        </section>
      </main>
    </div>
  </div>

  <div id="toasts" aria-live="polite"></div>
  <input type="file" id="file-xlsx" accept=".xls,.xlsx" class="sr-only" tabindex="-1" aria-label="Importer un fichier Excel">
  <input type="file" id="file-json" accept=".json,application/json" class="sr-only" tabindex="-1" aria-label="Importer un fichier JSON">

  <!-- Bibliothèques (CDN, versions figées). Défauts embarqués puis modules de l'application -->
  <script src="config/defaults.js?v=20261027-offres" defer></script>
  <!-- SheetJS avec styles (en-têtes Excel en gras sur fond gris) ; repli automatique sur SheetJS standard si indisponible -->
  <script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js" defer crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" defer crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" defer crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" defer crossorigin="anonymous"></script>
  <script src="assets/js/utils.js?v=20261104-r1" defer></script>
  <script src="assets/js/table.js?v=20261021-15" defer></script>
  <script src="assets/js/api.js?v=20261105-u1" defer></script>
  <script src="assets/js/store.js?v=20261027-offres" defer></script>
  <script src="assets/js/regles.js?v=20261027-offres" defer></script>
  <script src="assets/js/objectifs.js?v=20261104-s1" defer></script>
  <script src="assets/js/parser.js?v=20261027-offres" defer></script>
  <script src="assets/js/calculs.js?v=20261104-s1" defer></script>
  <script src="assets/js/ui.js?v=20261104-r1" defer></script>
  <script src="assets/js/dashboard.js?v=20261104-v1" defer></script>
  <script src="assets/js/rgz.js?v=20261104-s1" defer></script>
  <script src="assets/js/point_jour.js?v=20261104-s1" defer></script>
  <script src="assets/js/perf_partenaire.js?v=20261104-r1" defer></script>
  <script src="assets/js/export.js?v=20261104-k1" defer></script>
  <script src="assets/js/partage.js?v=20261104-k1" defer></script>
  <script src="assets/js/facturation_calc.js?v=20261104-y1" defer></script>
  <script src="assets/js/facturation.js?v=20261105-r1" defer></script>
  <script src="assets/js/analyse_calc.js?v=20261104-e1" defer></script>
  <script src="assets/js/analyse.js?v=20261104-k1" defer></script>
  <script src="assets/js/parametres.js?v=20261105-l1" defer></script>
  <script src="assets/js/app.js?v=20261105-g1" defer></script>
</body>
</html>
