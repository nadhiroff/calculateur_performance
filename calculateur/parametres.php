<?php
// Page réservée aux administrateurs connectés (sinon redirection vers connexion.php)
require dirname(__DIR__).'/vendor/autoload.php';
$admin = App\Auth::exiger('parametres.php');
$jeton = App\Auth::jeton();
$h = static fn (?string $s): string => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="fr" data-theme="auto">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <title>Paramètres — POWERGZ</title>
  <link rel="icon" type="image/png" href="assets/img/logoRGZ-64.png?v=2">
  <link rel="shortcut icon" href="favicon.ico?v=2">
  <link rel="apple-touch-icon" href="assets/img/logoRGZ-180.png?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
  <link rel="stylesheet" href="assets/css/design-system.css?v=20261021-15">
  <link rel="stylesheet" href="assets/css/components.css?v=20261023-m1">
  <link rel="stylesheet" href="assets/css/dashboard.css?v=20261023-v2">
  <style>
    :root { --header-h: 72px; }
    .param-bar { display: flex; gap: var(--sp-3); flex-wrap: wrap; align-items: flex-end; margin-bottom: var(--sp-5); padding: var(--sp-4); }
    .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(44px, 1fr)); gap: 6px; max-width: 420px; }
    .cal-grid .dow { font-size: var(--fs-12); color: var(--text-3); text-align: center; font-weight: 600; }
    .cal-day { min-height: 44px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-weight: 600; transition: background var(--t-fast), border-color var(--t-fast); }
    .cal-day[aria-pressed="true"] { background: var(--primary-600); color: #fff; border-color: var(--primary-600); }
    .cal-day:hover { border-color: var(--primary-600); }
    td[role="gridcell"] { cursor: cell; } td[role="gridcell"]:hover { background: var(--primary-soft); }
    td .input { min-width: 90px; }
    .status { font-size: var(--fs-12); color: var(--text-3); }
    .form-grid { display: grid; gap: var(--sp-4); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .hint { font-size: var(--fs-12); color: var(--text-3); }
    /* Fenêtre « Ajouter des objectifs » : champs plus étroits (3 par ligne sur ordinateur, 1 sur téléphone) */
    dialog.modal .form-grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--sp-3); }
    dialog.modal .stack { gap: var(--sp-4); padding-bottom: var(--sp-2); }
    dialog.modal .form-grid > * { min-width: 0; } dialog.modal .field .input, dialog.modal .field .select { width: 100%; min-width: 0; box-sizing: border-box; }
    #ao-mois { background: var(--surface-2); font-weight: 700; }
    @media (max-width: 480px) { dialog.modal .modal-foot .btn { flex: 1 1 100%; } }
    @media (max-width: 480px) {
      .cal-grid { grid-template-columns: repeat(7, minmax(36px, 1fr)); gap: 4px; max-width: 100%; }
      .cal-day { min-height: 36px; font-size: 13px; }
      .cal-grid .dow { font-size: 11px; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Aller au contenu</a>
  <div class="shell">
    <nav class="nav-tabs sidebar" id="nav" aria-label="Navigation principale">
      <a class="brand" href="index.php#dashboard" aria-label="POWERGZ — accueil"><img src="assets/img/logoRGZ-128.png" alt="" width="36" height="36"><span class="brand-txt">POWERGZ</span></a>
      <div class="nav-section">Pilotage</div>
      <a href="index.php#dashboard"><i class="fa-solid fa-chart-pie" aria-hidden="true"></i>Tableau de bord</a>
      <a href="index.php#point-du-jour"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i>Point du jour</a>
      <a href="index.php#performance"><i class="fa-solid fa-ranking-star" aria-hidden="true"></i>Performance partenaires</a>
      <div class="nav-section">Configuration</div>
      <a href="parametres.php" aria-current="page"><i class="fa-solid fa-sliders" aria-hidden="true"></i>Paramètres</a>
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
      <header class="app-header"><div class="container"><div class="topbar">
        <button type="button" id="mobile-menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="nav"><i class="fa-solid fa-bars"></i></button>
        <a class="topbar-brand" href="index.php#dashboard" aria-label="Accueil"><img src="assets/img/logoRGZ-128.png" alt="" width="30" height="30"></a>
        <div class="crumbs"><span>POWERGZ</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><b>Paramètres</b></div>
      </div></div></header>

      <main id="main" class="container">
        <div class="page-title"><div><span class="eyebrow">Configuration</span><h1>Paramètres</h1><p>Objectifs, règles de motivation et partenaires — modifiables sans toucher au code. <span class="status" id="statut" aria-live="polite"></span></p></div></div>
        <div class="tabs" role="tablist" aria-label="Sections des paramètres" id="tabs">
          <button role="tab" id="tab-obj" aria-controls="p-obj" aria-selected="true">Objectifs</button>
          <button role="tab" id="tab-regles" aria-controls="p-regles" aria-selected="false">Règles de motivation</button>
          <button role="tab" id="tab-part" aria-controls="p-part" aria-selected="false">Partenaires</button>
          <button role="tab" id="tab-save" aria-controls="p-save" aria-selected="false">Sauvegarde</button>
        </div>
        <div class="param-bar card" id="periode-bar">
          <div class="field"><label for="sel-periode">Période</label><select class="select" id="sel-periode"></select></div>
          <button class="btn btn-primary" id="btn-nouveau-mois" type="button"><i class="fa-solid fa-plus" aria-hidden="true"></i>Nouveau mois</button>
          <button class="btn btn-secondary" id="btn-dup-annee" type="button"><i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>Dupliquer l'année</button>
          <button class="btn btn-ghost" id="btn-reset-periode" type="button"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>Réinitialiser ce mois</button>
          <button class="btn btn-danger" id="btn-suppr-mois" type="button" style="margin-left:auto"><i class="fa-solid fa-trash" aria-hidden="true"></i>Supprimer ce mois</button>
        </div>
        <section id="p-obj" role="tabpanel" aria-labelledby="tab-obj"></section>
        <section id="p-regles" role="tabpanel" aria-labelledby="tab-regles" hidden></section>
        <section id="p-part" role="tabpanel" aria-labelledby="tab-part" hidden></section>
        <section id="p-save" role="tabpanel" aria-labelledby="tab-save" hidden></section>
      </main>
    </div>
  </div>
  <div id="toasts" aria-live="polite"></div>
  <input type="file" id="file-xlsx" accept=".xls,.xlsx" class="sr-only" tabindex="-1" aria-label="Importer un fichier Excel">
  <input type="file" id="file-json" accept=".json,application/json" class="sr-only" tabindex="-1" aria-label="Importer un fichier JSON">

  <script src="config/defaults.js?v=20261027-offres" defer></script>
  <!-- SheetJS avec styles (en-têtes Excel en gras sur fond gris) ; repli automatique sur SheetJS standard si indisponible -->
  <script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js" defer crossorigin="anonymous"></script>
  <script src="assets/js/utils.js?v=20261022-3" defer></script>
  <script src="assets/js/api.js?v=20261022-2" defer></script>
  <script src="assets/js/store.js?v=20261027-offres" defer></script>
  <script src="assets/js/regles.js?v=20261027-offres" defer></script>
  <script src="assets/js/objectifs.js?v=20261021-15" defer></script>
  <script src="assets/js/parametres.js?v=20261027-offres" defer></script>
</body>
</html>
