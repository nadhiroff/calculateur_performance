<?php
// Page réservée aux administrateurs connectés (sinon redirection vers connexion.php)
require dirname(__DIR__).'/vendor/autoload.php';
$admin = App\Auth::exiger('index.php');
$jeton = App\Auth::jeton();
$h = static fn (?string $s): string => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
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
  <link rel="stylesheet" href="assets/css/components.css?v=20261023-m1">
  <link rel="stylesheet" href="assets/css/dashboard.css?v=20261023-v2">
  <link rel="stylesheet" href="assets/css/print.css?v=20261021-15">
</head>
<body>
  <a class="skip-link" href="#main">Aller au contenu</a>

  <div class="shell">
    <!-- Sidebar : navigation principale (sur mobile, tiroir ouvert par #mobile-menu-btn) -->
    <nav class="nav-tabs sidebar" id="nav" aria-label="Navigation principale">
      <a class="brand" href="#dashboard" aria-label="POWERGZ — accueil"><img src="assets/img/logoRGZ-128.png" alt="" width="36" height="36"><span class="brand-txt">POWERGZ</span></a>
      <div class="nav-section">Pilotage</div>
      <a href="#dashboard" data-vue="dashboard"><i class="fa-solid fa-chart-pie" aria-hidden="true"></i>Tableau de bord</a>
      <a href="#rgz" data-vue="rgz"><i class="fa-solid fa-star" aria-hidden="true"></i>Tableau de bord RGZ</a>
      <a href="#point-du-jour" data-vue="pointjour"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i>Point du jour</a>
      <a href="#performance" data-vue="perf"><i class="fa-solid fa-ranking-star" aria-hidden="true"></i>Performance partenaires</a>
      <div class="nav-section">Configuration</div>
      <a href="parametres.php"><i class="fa-solid fa-sliders" aria-hidden="true"></i>Paramètres</a>
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
            <!-- Filtres de date globaux -->
            <div class="date-filters no-print" id="global-date-filters" hidden>
              <div class="field"><label for="global-date-debut">Date de début</label><input class="input input-sm" type="date" id="global-date-debut"></div>
              <div class="field"><label for="global-date-fin">Date de fin</label><input class="input input-sm" type="date" id="global-date-fin"></div>
              <button class="btn btn-secondary btn-sm" id="reset-filters" type="button"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>Réinitialiser</button>
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
      </main>
    </div>
  </div>

  <div id="toasts" aria-live="polite"></div>

  <!-- Bibliothèques (CDN, versions figées). Défauts embarqués puis modules de l'application -->
  <script src="config/defaults.js?v=20261021-15" defer></script>
  <!-- SheetJS avec styles (en-têtes Excel en gras sur fond gris) ; repli automatique sur SheetJS standard si indisponible -->
  <script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js" defer crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" defer crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" defer crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" defer crossorigin="anonymous"></script>
  <script src="assets/js/utils.js?v=20261022-3" defer></script>
  <script src="assets/js/table.js?v=20261021-15" defer></script>
  <script src="assets/js/api.js?v=20261022-2" defer></script>
  <script src="assets/js/store.js?v=20261023-h1" defer></script>
  <script src="assets/js/regles.js?v=20261021-15" defer></script>
  <script src="assets/js/objectifs.js?v=20261021-15" defer></script>
  <script src="assets/js/parser.js?v=20261021-15" defer></script>
  <script src="assets/js/calculs.js?v=20261022-m3" defer></script>
  <script src="assets/js/ui.js?v=20261022-e1" defer></script>
  <script src="assets/js/dashboard.js?v=20261023-v2" defer></script>
  <script src="assets/js/rgz.js?v=20261022-m1" defer></script>
  <script src="assets/js/point_jour.js?v=20261023-c4" defer></script>
  <script src="assets/js/perf_partenaire.js?v=20261022-m2" defer></script>
  <script src="assets/js/export.js?v=20261021-15" defer></script>
  <script src="assets/js/partage.js?v=20261023-m1" defer></script>
  <script src="assets/js/app.js?v=20261023-h1" defer></script>
</body>
</html>
