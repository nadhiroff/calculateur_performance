<?php

/*
| Espace d'un commercial RGZ : tableau de bord, ventes (B2C / B2B), équipe, primes et défis.
| Données calculées côté serveur par l'API agent/tableau. Menu latéral : fixe sur ordinateur, tiroir (hamburger) sur téléphone.
| Accès : commercial identifié (espace.php), ou administrateur connecté avec ?login=… (aperçu de ce que voit le commercial).
*/

use App\Auth;
use App\Support\LoginKey;

require dirname(__DIR__).'/vendor/autoload.php';

header('Cache-Control: no-store, private');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');

$agent = Auth::agent();
$apercu = $agent === null && Auth::admin() !== null && ! empty($_GET['login']) ? LoginKey::from((string) $_GET['login']) : null;
if ($agent === null && $apercu === null) {
    header('Location: espace.php', true, 302);
    exit;
}
$jeton = Auth::jeton();
$h = static fn (?string $s): string => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0B1B3A">
  <meta name="robots" content="noindex, nofollow">
  <title>RGZ Mon espace</title>
  <link rel="icon" type="image/png" href="assets/img/logoRGZ-64.png?v=2">
  <link rel="shortcut icon" href="favicon.ico?v=2">
  <link rel="apple-touch-icon" href="assets/img/logoRGZ-180.png?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
  <link rel="stylesheet" href="assets/css/design-system.css?v=20261021-15">
  <link rel="stylesheet" href="assets/css/mon-espace.css?v=20261022-11">
</head>
<body>
  <div class="coque">
    <!-- Menu : fixe sur ordinateur, tiroir sur téléphone -->
    <nav class="menu" id="menu" aria-label="Menu de mon espace">
      <div class="menu-marque"><img src="assets/img/logoRGZ-128.png" alt="" width="36" height="36"><span><b>Mon espace</b><small>Commercial RGZ</small></span></div>
      <div class="menu-qui">
        <span class="avatar" aria-hidden="true"><i class="fa-solid fa-user"></i></span>
        <span><b id="qui-login"><?= $h($agent['login'] ?? $apercu) ?></b><small><i class="fa-solid fa-people-group" aria-hidden="true"></i> Équipe <span id="qui-equipe"><?= $h($agent['equipe'] ?? '…') ?></span></small></span>
      </div>
      <a href="#accueil" data-vue="accueil"><i class="fa-solid fa-gauge-high" aria-hidden="true"></i>Tableau de bord</a>
      <a href="#ventes" data-vue="ventes"><i class="fa-solid fa-cart-shopping" aria-hidden="true"></i>Mes ventes</a>
      <a href="#equipe" data-vue="equipe"><i class="fa-solid fa-people-group" aria-hidden="true"></i>Mon équipe</a>
      <a href="#primes" data-vue="primes"><i class="fa-solid fa-trophy" aria-hidden="true"></i>Primes &amp; défis</a>
      <div class="menu-pied">
        <?php if ($agent !== null): ?>
          <form method="post" action="deconnexion.php" id="form-sortie">
            <input type="hidden" name="csrf" value="<?= $h($jeton) ?>"><input type="hidden" name="vers" value="espace">
            <button type="submit" class="sortie"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>Se déconnecter</button>
          </form>
        <?php else: ?>
          <span class="apercu-admin"><i class="fa-solid fa-eye" aria-hidden="true"></i> Aperçu administrateur</span>
        <?php endif; ?>
      </div>
    </nav>
    <div class="voile" id="voile" aria-hidden="true"></div>

    <div class="principal">
      <header class="entete">
        <button type="button" class="hamburger" id="hamburger" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="menu"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>
        <div class="titre"><h1 id="titre-vue">Tableau de bord</h1><small id="maj"></small></div>
        <!-- Période : filtre appliqué dès qu'une date change (comme dans la partie administrateur) -->
        <form class="periode" id="periode" aria-label="Période">
          <label><span>Date de début</span><input type="date" id="du" required></label>
          <label><span>Date de fin</span><input type="date" id="au" required></label>
          <button type="button" id="reinit" class="reinit" title="Revenir aux dernières données" aria-label="Revenir aux dernières données"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>Réinitialiser</span></button>
        </form>
      </header>

      <main id="contenu" class="contenu" data-login="<?= $h($apercu ?? '') ?>" aria-busy="true" aria-live="polite">
        <div class="chargement"><span class="roue" aria-hidden="true"></span>Chargement de vos résultats…</div>
      </main>
    </div>
  </div>

  <dialog class="confirm" id="confirm-sortie" aria-labelledby="confirm-titre">
    <h2 id="confirm-titre">Se déconnecter</h2>
    <p>Voulez-vous vraiment vous déconnecter ?</p>
    <div class="confirm-actions"><button type="button" value="non" class="b-non">Non</button><button type="button" value="oui" class="b-oui">Oui, me déconnecter</button></div>
  </dialog>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" defer crossorigin="anonymous"></script>
  <script src="assets/js/mon-espace.js?v=20261023-m1" defer></script>
</body>
</html>
