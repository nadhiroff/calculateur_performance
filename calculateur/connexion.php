<?php

/*
| Page de connexion des administrateurs. Pas de création de compte ni de mot de passe oublié :
| les comptes sont ajoutés directement dans la table « admins » (voir database/schema.sql).
*/

use App\Auth;
use App\Config;
use App\Journal;

require dirname(__DIR__).'/vendor/autoload.php';

date_default_timezone_set((string) Config::get('app.timezone', 'UTC'));
ini_set('display_errors', '0');
mb_internal_encoding('UTF-8');
header('Cache-Control: no-store, private');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

/** Page où revenir après connexion : uniquement une page de l'application (jamais une adresse extérieure). */
$retour = (string) ($_POST['retour'] ?? $_GET['retour'] ?? '');
if (! preg_match('/^(index|parametres)\.php(#[a-z0-9-]*)?$/', $retour)) {
    $retour = 'index.php';
}

$erreur = null;
$email = '';
try {
    if (Auth::admin() !== null) {
        header('Location: '.$retour, true, 302);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $email = trim((string) ($_POST['email'] ?? ''));
        $erreur = Auth::formulaireValide($_POST['csrf'] ?? null)
            ? Auth::connecter($email, (string) ($_POST['mot_de_passe'] ?? ''))
            : 'La page a expiré : réessayez.';
        if ($erreur === null) {
            header('Location: '.$retour, true, 303);
            exit;
        }
    }
    Auth::preparer();
    $jeton = Auth::jeton();
} catch (Throwable $e) {
    Journal::exception($e);
    $erreur = 'Connexion à la base de données impossible pour le moment. Réessayez dans un instant.';
    $jeton = '';
}

$sortie = isset($_GET['sortie']);
$expiree = ! $sortie && isset($_GET['expiree']) && $_SERVER['REQUEST_METHOD'] !== 'POST';   // envoyé par api.js sur une réponse 401
$e = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="robots" content="noindex, nofollow">
  <title>Connexion — POWERGZ</title>
  <link rel="icon" type="image/png" href="assets/img/logoRGZ-64.png?v=2">
  <link rel="shortcut icon" href="favicon.ico?v=2">
  <link rel="apple-touch-icon" href="assets/img/logoRGZ-180.png?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
  <link rel="stylesheet" href="assets/css/design-system.css?v=20261021-15">
  <style>
    /* Toute la page tient dans l'écran, sans défilement : tailles proportionnelles à la hauteur (vh) et à la largeur,
       éléments décoratifs masqués progressivement quand l'écran est bas. Le formulaire reste toujours entier. */
    * { box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body { margin: 0; height: 100vh; height: 100dvh; font-family: var(--font-body); background: var(--bg); color: var(--text);
      display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }

    /* ---------- Panneau de présentation (bleu nuit de la marque) ---------- */
    .vitrine { position: relative; overflow: hidden; color: #fff; min-height: 0;
      padding: clamp(20px, 5vh, 44px) clamp(24px, 4vw, 52px); display: flex; flex-direction: column; justify-content: flex-start; gap: clamp(12px, 3vh, 28px);
      background: radial-gradient(120% 90% at 0% 0%, #1D3FA8 0%, transparent 55%), linear-gradient(160deg, #10264F 0%, #0B1B3A 60%, #081430 100%); }
    .vitrine::before { content: ''; position: absolute; inset: 0; opacity: .5; pointer-events: none;
      background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
      background-size: 44px 44px; mask-image: radial-gradient(ellipse at 30% 40%, #000 20%, transparent 75%); }
    .bulle { position: absolute; border-radius: 50%; filter: blur(60px); opacity: .55; pointer-events: none; animation: flotter 18s ease-in-out infinite; }
    .bulle.b1 { width: 38vh; height: 38vh; background: #2450D3; top: -12vh; right: -8vh; }
    .bulle.b2 { width: 30vh; height: 30vh; background: #12A672; bottom: -10vh; left: -6vh; animation-delay: -6s; opacity: .35; }
    .bulle.b3 { width: 22vh; height: 22vh; background: #F2A007; top: 45%; right: 20%; animation-delay: -12s; opacity: .22; }
    @keyframes flotter { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -40px) scale(1.08); } 66% { transform: translate(-25px, 25px) scale(.95); } }

    .vitrine > :not(.bulle) { position: relative; z-index: 1; }
    .marque { display: flex; align-items: center; gap: 12px; }
    .marque img { width: clamp(36px, 5vh, 44px); height: clamp(36px, 5vh, 44px); border-radius: 10px; background: #fff; padding: 3px; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
    .marque b { display: block; color: #fff; font-family: var(--font-title); font-size: clamp(1rem, 2.2vh, 1.15rem); letter-spacing: -.01em; }
    .marque small { color: #A9B6D3; font-size: .75rem; }

    /* Texte remonté sous le logo (et non plus étalé sur toute la hauteur) ; seul le pied de page reste en bas */
    .accroche { margin-top: clamp(16px, 6vh, 60px); }
    .vitrine footer { margin-top: auto; }
    .accroche h1 { color: #fff; font-family: var(--font-title); font-size: clamp(1.5rem, min(2.8vw, 5vh), 2.7rem); line-height: 1.12; letter-spacing: -.025em; margin: 0 0 clamp(8px, 1.6vh, 14px); max-width: 18ch; }
    .accroche h1 span { background: linear-gradient(90deg, #7FA6FF, #5EE0B0); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .accroche p { color: #C5CFE2; font-size: clamp(.9rem, 2vh, 1.08rem); line-height: 1.55; margin: 0; max-width: 46ch; }

    .atouts { list-style: none; margin: clamp(10px, 2vh, 18px) 0 0; padding: 0; display: grid; gap: clamp(6px, 1.2vh, 10px); }
    .atouts li { display: flex; align-items: flex-start; gap: 12px; opacity: 0; transform: translateY(12px); animation: apparaitre .6s cubic-bezier(.2,.8,.2,1) forwards; }
    .atouts li:nth-child(1) { animation-delay: .35s; } .atouts li:nth-child(2) { animation-delay: .5s; } .atouts li:nth-child(3) { animation-delay: .65s; }
    .atouts i { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); color: #9DB8FF; font-size: .875rem; }
    .atouts b { display: block; font-size: .875rem; font-weight: 600; }
    .atouts small { color: #A9B6D3; font-size: .75rem; line-height: 1.4; }

    /* Mini tableau de bord animé (décoratif) */
    .apercu { align-self: flex-start; width: min(100%, 360px); padding: 14px 16px; border-radius: 14px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
      backdrop-filter: blur(8px); box-shadow: 0 20px 50px rgba(0,0,0,.25); animation: apparaitre .7s .8s cubic-bezier(.2,.8,.2,1) both, planer 6s 1.5s ease-in-out infinite; }
    .apercu-tete { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
    .apercu-tete small { color: #A9B6D3; font-size: .6875rem; }
    .apercu-tete b { font-family: var(--font-title); font-size: 1.15rem; }
    .apercu-tete em { font-style: normal; color: #5EE0B0; font-size: .75rem; font-weight: 600; margin-left: 6px; }
    .barres { display: flex; align-items: flex-end; gap: 7px; height: clamp(44px, 8vh, 68px); }
    .barres span { flex: 1; border-radius: 4px 4px 2px 2px; background: linear-gradient(180deg, #5B8CFF, #2450D3); transform-origin: bottom; transform: scaleY(0); animation: pousser .9s cubic-bezier(.2,.8,.2,1) forwards; }
    .barres span:nth-child(odd) { background: linear-gradient(180deg, #5EE0B0, #12A672); }
    .barres span:last-child { background: linear-gradient(180deg, #FFD27A, #F2A007); }
    @keyframes pousser { to { transform: scaleY(1); } }
    @keyframes planer { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes apparaitre { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

    .vitrine footer { color: #8592AD; font-size: .6875rem; }

    /* ---------- Formulaire ---------- */
    .acces { display: grid; place-items: center; min-height: 0; padding: clamp(16px, 4vh, 40px) clamp(16px, 4vw, 40px); }
    .carte { width: 100%; max-width: 380px; animation: apparaitre .6s .1s cubic-bezier(.2,.8,.2,1) both; }
    .badge-admin { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 999px; background: var(--primary-soft); color: var(--primary-600); font-size: .6875rem; font-weight: 600; margin-bottom: clamp(10px, 2vh, 16px); }
    .carte h2 { color: var(--text); font-family: var(--font-title); font-size: clamp(1.3rem, 3.2vh, 1.6rem); letter-spacing: -.02em; margin: 0 0 6px; }
    .carte > p { color: var(--text-3); margin: 0 0 clamp(14px, 3vh, 24px); font-size: .875rem; line-height: 1.5; }

    .champ { margin-bottom: clamp(10px, 2vh, 16px); }
    .champ label { display: block; font-size: .78rem; font-weight: 600; color: var(--text-2); margin-bottom: 6px; }
    .saisie { position: relative; }
    .saisie > i { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: var(--text-3); font-size: .85rem; pointer-events: none; transition: color var(--t-fast); }
    .saisie input { width: 100%; height: clamp(40px, 5.6vh, 46px); padding: 0 42px; border-radius: var(--r-md); border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font: inherit; font-size: 16px; transition: border-color var(--t-fast), box-shadow var(--t-fast); }   /* 16 px minimum : sinon le téléphone zoome sur le champ et la page se coupe */
    .saisie input::placeholder { color: var(--text-3); opacity: .8; }
    .saisie input:focus { outline: none; border-color: var(--primary-600); box-shadow: 0 0 0 4px var(--primary-ring); }
    .saisie:focus-within > i { color: var(--primary-600); }
    .oeil { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border: 0; border-radius: 8px; background: transparent; color: var(--text-3); cursor: pointer; display: grid; place-items: center; }
    .oeil:hover { background: var(--surface-2); color: var(--text); }
    .oeil:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    .majuscules { display: none; margin-top: 6px; font-size: .72rem; color: var(--warn-text); }
    .majuscules.visible { display: flex; align-items: center; gap: 6px; }

    .bouton { width: 100%; height: clamp(42px, 5.8vh, 48px); margin-top: 4px; border: 0; border-radius: var(--r-md); cursor: pointer; font: inherit; font-weight: 600; font-size: .9rem; color: #fff;
      background: linear-gradient(135deg, var(--primary-600), var(--primary)); box-shadow: 0 8px 20px rgba(36,80,211,.28); display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      transition: transform var(--t-fast), box-shadow var(--t-fast), filter var(--t-fast); }
    .bouton:hover { transform: translateY(-1px); box-shadow: 0 12px 26px rgba(36,80,211,.34); filter: brightness(1.05); }
    .bouton:active { transform: none; }
    .bouton:focus-visible { outline: 3px solid var(--primary-ring); outline-offset: 2px; }
    .bouton .roue { display: none; width: 17px; height: 17px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: tourner .7s linear infinite; }
    .bouton.charge { pointer-events: none; filter: saturate(.85); }
    .bouton.charge .roue { display: inline-block; }
    .bouton.charge .fleche { display: none; }
    @keyframes tourner { to { transform: rotate(360deg); } }

    .alerte { position: relative; overflow: hidden; display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--r-md); margin-bottom: clamp(10px, 2vh, 16px); font-size: .8125rem; line-height: 1.4;
      max-height: 200px; transition: opacity .35s ease, max-height .4s ease, margin .4s ease, padding .4s ease; }
    /* Barre de temps restant avant disparition automatique (durée posée par le script dans --duree) */
    .alerte::after { content: ''; position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: currentColor; opacity: .35; transform-origin: left; animation: decompte var(--duree, 5s) linear forwards; }
    .alerte.masquee { opacity: 0; max-height: 0; margin-bottom: 0; padding-top: 0; padding-bottom: 0; }
    @keyframes decompte { to { transform: scaleX(0); } }
    .alerte i { margin-top: 2px; }
    .alerte.neg { background: var(--neg-soft); color: var(--neg-text); border: 1px solid color-mix(in srgb, var(--neg) 30%, transparent); animation: secouer .45s cubic-bezier(.36,.07,.19,.97); }
    .alerte.info { background: var(--info-soft); color: var(--info-text); border: 1px solid color-mix(in srgb, var(--info) 25%, transparent); }
    .alerte.pos { background: var(--pos-soft); color: var(--pos-text); border: 1px solid color-mix(in srgb, var(--pos) 25%, transparent); }
    @keyframes secouer { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(2px); } 30%, 50%, 70% { transform: translateX(-4px); } 40%, 60% { transform: translateX(4px); } }

    .aide { margin-top: clamp(14px, 3vh, 24px); padding-top: clamp(10px, 2vh, 16px); border-top: 1px solid var(--border); display: flex; gap: 10px; color: var(--text-3); font-size: .75rem; line-height: 1.45; }
    .aide i { color: var(--text-3); margin-top: 2px; }
    .aide a { color: var(--primary-600); font-weight: 600; text-decoration: none; }
    .aide a:hover { text-decoration: underline; }

    /* ---------- Écrans bas (portables, fenêtres réduites) : on retire d'abord le décoratif ---------- */
    /* Hauteur réduite (PC portables) : la liste des modules cède la place, l'aperçu « Suivi quotidien » reste visible, plus compact */
    @media (max-height: 820px) { .atouts { display: none; } .apercu { padding: 12px 14px; } }
    @media (max-height: 480px) { .apercu { display: none; } }
    @media (max-height: 640px) { .atouts, .vitrine footer { display: none; } }
    @media (max-height: 500px) { .accroche p, .aide { display: none; } }
    @media (max-height: 720px) { .carte:has(.alerte) > p { display: none; } }   /* un message affiché prend la place de l'introduction */

    /* ---------- Tablette / mobile : la présentation devient un bandeau compact au-dessus du formulaire ---------- */
    @media (max-width: 960px) {
      body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
      .vitrine { padding: clamp(14px, 3vh, 28px) clamp(16px, 5vw, 32px); gap: clamp(8px, 1.6vh, 16px); justify-content: flex-start; }
      .atouts, .vitrine footer { display: none; }
      /* Téléphone : aperçu « Suivi quotidien » en version compacte dans le bandeau (toujours visible, sauf écran minuscule) */
      .apercu { width: 100%; padding: 8px 12px; border-radius: 12px; }
      .apercu-tete { margin-bottom: 6px; align-items: center; }
      .apercu-tete b { font-size: .9rem; }
      .apercu-tete br, .apercu-tete span > small { display: none; }
      .barres { height: 26px; gap: 5px; }
      .accroche { margin-top: 0; }
      .accroche h1 { font-size: clamp(1.15rem, 3vh, 1.6rem); max-width: none; margin-bottom: 6px; }
      .accroche p { font-size: .8rem; line-height: 1.45; }
      .acces { padding: clamp(14px, 3vh, 32px) 16px; }
    }
    /* Téléphone, hauteur VISIBLE (barres du navigateur déduites) : on retire d'abord le texte, l'aperçu reste le plus longtemps */
    @media (max-width: 960px) and (max-height: 760px) { .carte > p, .badge-admin { display: none; } }
    @media (max-width: 960px) and (max-height: 640px) { .aide { display: none; } }
    @media (max-width: 960px) and (max-height: 520px) { .accroche { display: none; } }
    @media (max-width: 960px) and (max-height: 460px) { .apercu { display: none; } }

    /* Écran vraiment trop petit pour tout afficher (téléphone couché…) : on autorise le défilement plutôt que de couper le formulaire */
    @media (max-height: 420px) { html, body { overflow: auto; } body { height: auto; min-height: 100dvh; } }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; animation-delay: 0s !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <aside class="vitrine" aria-label="Présentation de la plateforme">
    <span class="bulle b1" aria-hidden="true"></span><span class="bulle b2" aria-hidden="true"></span><span class="bulle b3" aria-hidden="true"></span>

    <div class="marque">
      <img src="assets/img/logoRGZ-128.png" alt="" width="48" height="48">
      <span><b>POWERGZ</b></span>
    </div>

    <div class="accroche">
      <h1>Pilotez vos ventes FTTH <span>en un coup d'œil</span>.</h1>
      <p>La plateforme de suivi des souscriptions Celtiis : chiffres du jour, objectifs mensuels et performance de chaque partenaire, à partir des fichiers importés.</p>
      <ul class="atouts">
        <li><i class="fa-solid fa-chart-pie" aria-hidden="true"></i><span><b>Tableau de bord</b><small>Souscriptions, ventes validées et chiffre d'affaires sur la période choisie.</small></span></li>
        <li><i class="fa-solid fa-calendar-day" aria-hidden="true"></i><span><b>Point du jour</b><small>Réalisé face aux objectifs, équipe par équipe, prêt à partager.</small></span></li>
        <li><i class="fa-solid fa-ranking-star" aria-hidden="true"></i><span><b>Performance partenaires</b><small>Classements, primes et taux de réalisation, RGZ mis en avant.</small></span></li>
      </ul>
    </div>

    <div class="apercu" aria-hidden="true">
      <div class="apercu-tete"><span><small>Aperçu</small><br><b>Suivi quotidien</b><em><i class="fa-solid fa-arrow-trend-up"></i></em></span><small>Souscriptions par jour</small></div>
      <div class="barres">
        <span style="height:42%;animation-delay:1.0s"></span><span style="height:58%;animation-delay:1.08s"></span><span style="height:50%;animation-delay:1.16s"></span>
        <span style="height:66%;animation-delay:1.24s"></span><span style="height:61%;animation-delay:1.32s"></span><span style="height:78%;animation-delay:1.40s"></span>
        <span style="height:72%;animation-delay:1.48s"></span><span style="height:88%;animation-delay:1.56s"></span><span style="height:100%;animation-delay:1.64s"></span>
      </div>
    </div>

    <footer>© <?= date('Y') ?> RGZ — Accès réservé aux administrateurs autorisés.</footer>
  </aside>

  <main class="acces">
    <div class="carte">
      <span class="badge-admin"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i>Espace administrateur</span>
      <h2>Connexion</h2>
      <p>Saisissez les identifiants qui vous ont été attribués pour accéder à la plateforme.</p>

      <?php if ($erreur !== null): ?>
        <div class="alerte neg" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span><?= $e($erreur) ?></span></div>
      <?php elseif ($sortie): ?>
        <div class="alerte pos" role="status"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Vous êtes déconnecté. À bientôt !</span></div>
      <?php elseif ($expiree): ?>
        <div class="alerte info" role="status"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>Votre session a expiré : reconnectez-vous pour continuer.</span></div>
      <?php endif; ?>

      <form method="post" action="connexion.php" id="form-connexion" novalidate>
        <input type="hidden" name="csrf" value="<?= $e($jeton) ?>">
        <input type="hidden" name="retour" value="<?= $e($retour) ?>" id="retour">

        <div class="champ">
          <label for="email">Adresse email</label>
          <div class="saisie">
            <i class="fa-regular fa-envelope" aria-hidden="true"></i>
            <input type="email" id="email" name="email" value="<?= $e($email) ?>" placeholder="prenom@rgz.bj" autocomplete="username" required <?= $email === '' ? 'autofocus' : '' ?>>
          </div>
        </div>

        <div class="champ">
          <label for="mot_de_passe">Mot de passe</label>
          <div class="saisie">
            <i class="fa-solid fa-lock" aria-hidden="true"></i>
            <input type="password" id="mot_de_passe" name="mot_de_passe" placeholder="••••••••" autocomplete="current-password" required <?= $email !== '' ? 'autofocus' : '' ?>>
            <button type="button" class="oeil" id="oeil" aria-label="Afficher le mot de passe" aria-pressed="false"><i class="fa-regular fa-eye" aria-hidden="true"></i></button>
          </div>
          <div class="majuscules" id="majuscules" role="status"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Majuscules activées</div>
        </div>

        <button type="submit" class="bouton" id="bouton"><span class="roue" aria-hidden="true"></span>Se connecter<i class="fa-solid fa-arrow-right fleche" aria-hidden="true"></i></button>
      </form>

      <div class="aide">
        <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
        <span>Accès réservé aux administrateurs. Besoin d'un accès ou mot de passe perdu ? Contactez la direction : <a href="mailto:nadhir@rgz.bj">nadhir@rgz.bj</a></span>
      </div>
    </div>
  </main>

  <script>
    (function () {
      'use strict';
      // Le fragment (#point-du-jour…) n'est jamais envoyé au serveur : on le rajoute à la page de retour
      const retour = document.getElementById('retour');
      if (location.hash && !retour.value.includes('#') && /^#[a-z0-9-]+$/.test(location.hash)) retour.value += location.hash;

      // Messages (déconnexion, session expirée, erreur) : disparition automatique, plus longue pour une erreur
      document.querySelectorAll('.alerte').forEach((a) => {
        const duree = a.classList.contains('neg') ? 8000 : 5000;
        a.style.setProperty('--duree', duree + 'ms');
        setTimeout(() => { a.classList.add('masquee'); setTimeout(() => a.remove(), 450); }, duree);
      });
      // « ?sortie=1 » / « ?expiree=1 » retirés de l'adresse : une actualisation ne réaffiche pas le message
      if (/[?&](sortie|expiree)=/.test(location.search)) {
        const u = new URL(location.href); u.searchParams.delete('sortie'); u.searchParams.delete('expiree');
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      }

      const mdp = document.getElementById('mot_de_passe'), oeil = document.getElementById('oeil');
      oeil.addEventListener('click', () => {
        const visible = mdp.type === 'password';
        mdp.type = visible ? 'text' : 'password';
        oeil.setAttribute('aria-pressed', String(visible));
        oeil.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
        oeil.innerHTML = '<i class="fa-regular ' + (visible ? 'fa-eye-slash' : 'fa-eye') + '" aria-hidden="true"></i>';
        mdp.focus();
      });

      const maj = document.getElementById('majuscules');
      ['keydown', 'keyup'].forEach((ev) => mdp.addEventListener(ev, (e) => { if (e.getModifierState) maj.classList.toggle('visible', e.getModifierState('CapsLock')); }));
      mdp.addEventListener('blur', () => maj.classList.remove('visible'));

      document.getElementById('form-connexion').addEventListener('submit', (e) => {
        const email = document.getElementById('email');
        if (!email.value.trim() || !mdp.value) { e.preventDefault(); (email.value.trim() ? mdp : email).focus(); return; }
        document.getElementById('bouton').classList.add('charge');
      });
    })();
  </script>
</body>
</html>
