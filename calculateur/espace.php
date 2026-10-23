<?php

/*
| Espace commercial RGZ : identification par le login Celtiis (logins présents dans les objectifs RGZ).
| Login exact → félicitations + équipe, puis redirection vers mon-espace.php. Faute de frappe → logins proches proposés.
| Login inconnu → contact de la direction.
*/

use App\Auth;
use App\Config;
use App\Journal;
use App\Services\AgentAnnuaire;

require dirname(__DIR__).'/vendor/autoload.php';

date_default_timezone_set((string) Config::get('app.timezone', 'UTC'));
ini_set('display_errors', '0');
mb_internal_encoding('UTF-8');
header('Cache-Control: no-store, private');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$etat = 'formulaire';   // formulaire | succes | proches | inconnu
$message = null;
$saisie = '';
$trouve = null;
$proches = [];
try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' && ! isset($_GET['sortie']) && Auth::agent() !== null) {
        header('Location: mon-espace.php', true, 302);
        exit;
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $saisie = trim((string) ($_POST['login'] ?? ''));
        $attente = Auth::minutesDeBlocageAgent();
        if (! Auth::formulaireValide($_POST['csrf'] ?? null)) {
            $message = 'La page a expiré : réessayez.';
        } elseif ($attente > 0) {
            $message = 'Trop de logins inconnus saisis. Réessayez dans '.$attente.' minute'.($attente > 1 ? 's' : '').'.';
        } elseif ($saisie === '') {
            $message = 'Saisissez votre login.';
        } else {
            $r = AgentAnnuaire::chercher($saisie);
            if ($r['exact'] !== null) {
                $trouve = $r['exact'];
                Auth::connecterAgent($trouve);
                $etat = 'succes';
            } elseif ($r['proches']) {
                $proches = $r['proches'];
                $etat = 'proches';
            } else {
                Auth::noterEchecAgent($saisie);
                Journal::avertissement('Espace commercial : login inconnu « '.mb_substr($saisie, 0, 120).' » depuis '.($_SERVER['REMOTE_ADDR'] ?? '').'.');
                $etat = 'inconnu';
            }
        }
    }
    Auth::preparer();
    $jeton = Auth::jeton();
} catch (Throwable $e) {
    Journal::exception($e);
    $message = 'Service momentanément indisponible. Réessayez dans un instant.';
    $etat = 'formulaire';
    $jeton = '';
}
$e = static fn (?string $s): string => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
$sortie = isset($_GET['sortie']) && $_SERVER['REQUEST_METHOD'] !== 'POST';
$expiree = isset($_GET['expiree']) && $_SERVER['REQUEST_METHOD'] !== 'POST';
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0B1B3A">
  <meta name="robots" content="noindex, nofollow">
  <title>Espace commercial RGZ — POWERGZ</title>
  <link rel="icon" type="image/png" href="assets/img/logoRGZ-64.png?v=2">
  <link rel="shortcut icon" href="favicon.ico?v=2">
  <link rel="apple-touch-icon" href="assets/img/logoRGZ-180.png?v=2">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
  <link rel="stylesheet" href="assets/css/design-system.css?v=20261021-15">
  <style>
    /* Une seule colonne centrée, pensée pour le téléphone ; tout tient dans l'écran, sans défilement */
    * { box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    html { background: #081430; }   /* même bleu nuit que la page : jamais de bande noire ou blanche si le téléphone décale l'écran */
    body { margin: 0; height: 100vh; height: 100dvh; font-family: var(--font-body); color: #fff; position: relative;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(14px, 3vh, 28px); padding: clamp(16px, 4vh, 40px) 16px;
      background: radial-gradient(110% 70% at 0% 0%, #1D3FA8 0%, transparent 60%), linear-gradient(165deg, #10264F 0%, #0B1B3A 55%, #081430 100%); }
    body::before { content: ''; position: fixed; inset: 0; pointer-events: none; opacity: .45;
      background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
      background-size: 40px 40px; mask-image: radial-gradient(ellipse at 50% 30%, #000 15%, transparent 70%); }
    .bulle { position: fixed; border-radius: 50%; filter: blur(60px); pointer-events: none; animation: flotter 18s ease-in-out infinite; }
    .bulle.b1 { width: 42vmax; height: 42vmax; background: #2450D3; top: -18vmax; right: -14vmax; opacity: .5; }
    .bulle.b2 { width: 34vmax; height: 34vmax; background: #F2A007; bottom: -16vmax; left: -12vmax; opacity: .25; animation-delay: -7s; }
    .bulle.b3 { width: 24vmax; height: 24vmax; background: #12A672; bottom: 10%; right: -8vmax; opacity: .22; animation-delay: -12s; }
    @keyframes flotter { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-3vmax, 3vmax) scale(1.08); } }
    body > * { position: relative; z-index: 1; }

    .tete { text-align: center; max-width: 440px; animation: apparaitre .6s cubic-bezier(.2,.8,.2,1) both; }
    .tete img { width: clamp(44px, 7vh, 56px); height: clamp(44px, 7vh, 56px); border-radius: 14px; background: #fff; padding: 4px; box-shadow: 0 10px 30px rgba(0,0,0,.3); }
    .tete .eyebrow { display: block; margin-top: clamp(8px, 1.6vh, 14px); color: #FFD27A; letter-spacing: .12em; }
    .tete h1 { color: #fff; font-family: var(--font-title); font-size: clamp(1.35rem, 3.6vh, 1.85rem); margin: 6px 0 6px; letter-spacing: -.02em; }
    .tete p { color: #C5CFE2; font-size: clamp(.8125rem, 1.9vh, .9375rem); line-height: 1.5; margin: 0; }

    .carte { width: 100%; max-width: 420px; background: var(--surface); color: var(--text); border-radius: 20px; padding: clamp(18px, 3.4vh, 28px) clamp(18px, 5vw, 28px);
      box-shadow: 0 24px 60px rgba(0,0,0,.35); animation: apparaitre .6s .12s cubic-bezier(.2,.8,.2,1) both; }
    .carte h2 { color: var(--text); font-family: var(--font-title); font-size: clamp(1.1rem, 2.8vh, 1.3rem); margin: 0 0 4px; }
    .carte .sous { color: var(--text-3); font-size: .8125rem; line-height: 1.5; margin: 0 0 clamp(12px, 2.4vh, 18px); }
    label { display: block; font-size: .78rem; font-weight: 600; color: var(--text-2); margin-bottom: 6px; }
    .saisie { position: relative; }
    .saisie i { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; transition: color var(--t-fast); }
    .saisie input { width: 100%; height: clamp(46px, 6.4vh, 52px); padding: 0 14px 0 42px; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text);
      font: inherit; font-size: 1rem; transition: border-color var(--t-fast), box-shadow var(--t-fast); }   /* 16 px : pas de zoom automatique sur iPhone */
    .saisie input:focus { outline: none; border-color: var(--primary-600); box-shadow: 0 0 0 4px var(--primary-ring); }
    .saisie:focus-within i { color: var(--primary-600); }
    .astuce { font-size: .72rem; color: var(--text-3); margin: 6px 0 0; }
    .bouton { width: 100%; height: clamp(46px, 6.4vh, 52px); margin-top: clamp(12px, 2.4vh, 18px); border: 0; border-radius: 12px; cursor: pointer; font: inherit; font-weight: 700; font-size: .95rem; color: #fff;
      background: linear-gradient(135deg, var(--primary-600), var(--primary)); box-shadow: 0 10px 24px rgba(36,80,211,.3); display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      text-decoration: none; transition: transform var(--t-fast), filter var(--t-fast); }
    .bouton:hover { transform: translateY(-1px); filter: brightness(1.05); }
    .bouton:focus-visible { outline: 3px solid var(--primary-ring); outline-offset: 2px; }
    .bouton.secondaire { background: var(--surface-2); color: var(--text); box-shadow: none; border: 1px solid var(--border); }
    .bouton .roue { display: none; width: 18px; height: 18px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: tourner .7s linear infinite; }
    .bouton.charge { pointer-events: none; } .bouton.charge .roue { display: inline-block; } .bouton.charge .fleche { display: none; }

    .alerte { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; margin-bottom: 14px; font-size: .8125rem; line-height: 1.45; }
    .alerte i { margin-top: 2px; }
    .alerte.neg { background: var(--neg-soft); color: var(--neg-text); animation: secouer .45s cubic-bezier(.36,.07,.19,.97); }
    .alerte.pos { background: var(--pos-soft); color: var(--pos-text); }
    .alerte.info { background: var(--info-soft); color: var(--info-text); }
    .alerte a { color: inherit; font-weight: 700; }

    /* Logins proches */
    .choix { display: grid; gap: 8px; margin: 0 0 12px; }
    .choix button { width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font: inherit; cursor: pointer; transition: border-color var(--t-fast), background var(--t-fast); }
    .choix button:hover, .choix button:focus-visible { border-color: var(--primary-600); background: var(--primary-soft); outline: none; }
    .choix b { display: block; font-size: .9rem; word-break: break-all; }
    .choix small { color: var(--text-3); font-size: .75rem; }
    .choix i.fa-user { width: 34px; height: 34px; flex: none; border-radius: 10px; display: grid; place-items: center; background: var(--primary-soft); color: var(--primary-600); }
    .choix i.fa-chevron-right { margin-left: auto; color: var(--text-3); font-size: .8rem; }

    /* Félicitations */
    .succes { text-align: center; }
    .coche { width: 76px; height: 76px; margin: 0 auto 14px; border-radius: 50%; display: grid; place-items: center; background: var(--pos-soft); animation: bondir .6s cubic-bezier(.2,1.4,.4,1) both; }
    .coche svg { width: 40px; height: 40px; }
    .coche path { stroke: var(--pos); stroke-width: 4; fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 40; stroke-dashoffset: 40; animation: tracer .5s .35s ease forwards; }
    .succes h2 { font-size: 1.5rem; }
    .succes .qui { margin: 10px 0 4px; font-size: .9rem; color: var(--text-2); }
    .succes .qui b { color: var(--text); word-break: break-all; }
    .equipe { display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 14px; border-radius: 999px; background: #FEF5E1; color: #92560A; font-weight: 700; font-size: .875rem; }
    .redirection { height: 4px; border-radius: 4px; background: var(--surface-3); overflow: hidden; margin-top: 16px; }
    .redirection span { display: block; width: 0; height: 100%; background: var(--pos); border-radius: 4px; }   /* largeur avancée par le script */
    .succes small.note { display: block; color: var(--text-3); font-size: .75rem; margin-top: 8px; }
    .confettis { position: fixed; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
    .confettis i { position: absolute; top: -12px; width: 8px; height: 14px; border-radius: 2px; opacity: .9; animation: tomber linear forwards; }

    .pied { font-size: .75rem; color: #A9B6D3; text-align: center; max-width: 420px; line-height: 1.5; }
    .pied a { color: #fff; font-weight: 600; }

    @keyframes apparaitre { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes secouer { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(2px); } 30%, 50%, 70% { transform: translateX(-4px); } 40%, 60% { transform: translateX(4px); } }
    @keyframes tourner { to { transform: rotate(360deg); } }
    @keyframes bondir { from { transform: scale(.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    @keyframes tracer { to { stroke-dashoffset: 0; } }
    @keyframes tomber { to { transform: translateY(110vh) rotate(720deg); } }

    @media (max-height: 640px) { .tete p, .astuce { display: none; } .tete .eyebrow { display: none; } }
    /* Mode « clavier » (téléphone, champ login touché) : présentation et pied masqués, carte en haut de l'écran.
       Le champ reste visible au-dessus du clavier sans que la page ait à défiler ; tout revient quand le clavier se ferme. */
    body.clavier { justify-content: flex-start; padding-top: calc(14px + env(safe-area-inset-top, 0px)); }
    body.clavier .tete, body.clavier .pied { display: none; }
    body.clavier .carte { animation: none; }
    @media (max-height: 540px) { .tete { display: none; } .pied { display: none; } }
    @media (max-height: 420px) { html, body { overflow: auto; } body { height: auto; min-height: 100dvh; justify-content: flex-start; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition: none !important; } }
  </style>
</head>
<body>
  <span class="bulle b1" aria-hidden="true"></span><span class="bulle b2" aria-hidden="true"></span><span class="bulle b3" aria-hidden="true"></span>

  <header class="tete">
    <img src="assets/img/logoRGZ-128.png" alt="" width="56" height="56">
    <span class="eyebrow">Espace commercial RGZ</span>
    <h1>Vos résultats, en un coup d'œil</h1>
    <p>Ventes, objectif du mois, primes estimées et classement de votre équipe, directement sur votre téléphone.</p>
  </header>

  <main class="carte">
  <?php if ($etat === 'succes'): ?>
    <div class="succes" role="status">
      <div class="coche" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M10 21 l7 7 l14 -15"/></svg></div>
      <h2>Félicitations !</h2>
      <p class="qui">C'est bien vous : <b><?= $e($trouve['login']) ?></b></p>
      <span class="equipe"><i class="fa-solid fa-people-group" aria-hidden="true"></i>Équipe <?= $e($trouve['equipe']) ?></span>
      <a class="bouton" href="mon-espace.php" id="continuer">Voir mes résultats<i class="fa-solid fa-arrow-right fleche" aria-hidden="true"></i></a>
      <div class="redirection" aria-hidden="true"><span id="barre"></span></div>
      <small class="note" id="compte" aria-live="polite">Ouverture automatique de votre espace…</small>
    </div>
    <div class="confettis" aria-hidden="true" id="confettis"></div>

  <?php elseif ($etat === 'proches'): ?>
    <h2>Vouliez-vous dire…</h2>
    <p class="sous">« <?= $e($saisie) ?> » n'existe pas tel quel. Choisissez <b>votre</b> login :</p>
    <div class="choix">
      <?php foreach ($proches as $p): ?>
        <form method="post" action="espace.php">
          <input type="hidden" name="csrf" value="<?= $e($jeton) ?>"><input type="hidden" name="login" value="<?= $e($p['login']) ?>">
          <button type="submit"><i class="fa-solid fa-user" aria-hidden="true"></i><span><b><?= $e($p['login']) ?></b><small>Équipe <?= $e($p['equipe']) ?></small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
        </form>
      <?php endforeach; ?>
    </div>
    <a class="bouton secondaire" href="espace.php"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>Aucun, ressaisir mon login</a>

  <?php else: ?>
    <?php if ($etat === 'inconnu'): ?>
      <div class="alerte neg" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>Le login « <?= $e($saisie) ?> » n'est pas reconnu. Vérifiez-le, ou contactez la direction : <a href="mailto:nadhir@rgz.bj">nadhir@rgz.bj</a></span></div>
    <?php elseif ($message !== null): ?>
      <div class="alerte neg" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span><?= $e($message) ?></span></div>
    <?php elseif ($sortie): ?>
      <div class="alerte pos" role="status"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Vous êtes déconnecté. À bientôt !</span></div>
    <?php elseif ($expiree): ?>
      <div class="alerte info" role="status"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>Votre session a expiré : saisissez à nouveau votre login.</span></div>
    <?php endif; ?>
    <h2>Identifiez-vous</h2>
    <p class="sous">Saisissez votre login Celtiis, celui qui apparaît sur vos ventes.</p>
    <form method="post" action="espace.php" id="form-login" novalidate>
      <input type="hidden" name="csrf" value="<?= $e($jeton) ?>">
      <label for="login">Votre login</label>
      <div class="saisie">
        <i class="fa-solid fa-id-badge" aria-hidden="true"></i>
        <input type="text" id="login" name="login" value="<?= $e($saisie) ?>" placeholder="ex. pvt_rgz_monlogin" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      </div>
      <p class="astuce">Majuscules, tirets ou « .ftth » : pas d'importance.</p>
      <button type="submit" class="bouton" id="bouton"><span class="roue" aria-hidden="true"></span>Accéder à mon espace<i class="fa-solid fa-arrow-right fleche" aria-hidden="true"></i></button>
    </form>
  <?php endif; ?>
  </main>

  <p class="pied">Réservé aux commerciaux RGZ. Un problème avec votre login ? <a href="mailto:nadhir@rgz.bj">nadhir@rgz.bj</a></p>

  <script>
    (function () {
      'use strict';
      const form = document.getElementById('form-login');
      if (form) {
        const champ = document.getElementById('login');
        if (!champ.value && window.matchMedia('(min-width: 700px)').matches) champ.focus();   // pas de clavier qui surgit sur téléphone

        // Clavier du téléphone : la carte remonte (présentation masquée) tant que le clavier est ouvert, puis tout revient en place.
        // Fermeture détectée par la perte du focus ET par le retour à la hauteur d'écran (bouton « retour » Android, focus conservé).
        const tactile = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 900px)').matches;
        const vv = window.visualViewport;
        let hauteurPleine = Math.max(window.innerHeight, vv ? vv.height : 0);
        const remettre = () => { document.body.classList.remove('clavier'); window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; };
        if (tactile) {
          champ.addEventListener('focus', () => { document.body.classList.add('clavier'); window.scrollTo(0, 0); });
          champ.addEventListener('blur', () => setTimeout(remettre, 150));   // après le « clic » éventuel sur le bouton, avant de redescendre
          if (vv) vv.addEventListener('resize', () => {
            hauteurPleine = Math.max(hauteurPleine, vv.height, document.body.classList.contains('clavier') ? 0 : window.innerHeight);
            if (vv.height > hauteurPleine * 0.85) { remettre(); if (document.activeElement === champ) champ.blur(); }   // clavier fermé
            else if (document.activeElement === champ) window.scrollTo(0, 0);
          });
          window.addEventListener('orientationchange', () => setTimeout(() => { hauteurPleine = 0; remettre(); }, 300));
        }
        form.addEventListener('submit', (e) => { if (!champ.value.trim()) { e.preventDefault(); champ.focus(); return; } document.getElementById('bouton').classList.add('charge'); });
      }
      // Messages : disparition automatique ; paramètres retirés de l'adresse
      document.querySelectorAll('.alerte.pos, .alerte.info').forEach((a) => setTimeout(() => { a.style.transition = 'opacity .35s'; a.style.opacity = '0'; setTimeout(() => a.remove(), 400); }, 5000));
      if (/[?&](sortie|expiree)=/.test(location.search)) history.replaceState(null, '', location.pathname);

      // Félicitations : confettis puis ouverture de l'espace
      const conf = document.getElementById('confettis');
      if (conf) {
        const couleurs = ['#2450D3', '#12A672', '#F2A007', '#E5484D', '#7FA6FF'];
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) for (let i = 0; i < 40; i++) {
          const c = document.createElement('i');
          c.style.left = Math.random() * 100 + '%'; c.style.background = couleurs[i % couleurs.length];
          c.style.animationDuration = 2.2 + Math.random() * 2 + 's'; c.style.animationDelay = Math.random() * .6 + 's';
          conf.appendChild(c);
        }
        // Barre et compte à rebours avancés par script (et non en CSS) : visibles même quand le téléphone réduit les animations
        const duree = 4000, debut = Date.now(), barre = document.getElementById('barre'), compte = document.getElementById('compte');
        const avancer = () => {
          const ecoule = Date.now() - debut, reste = Math.max(0, Math.ceil((duree - ecoule) / 1000));
          barre.style.width = Math.min(100, (ecoule / duree) * 100) + '%';
          compte.textContent = reste > 0 ? 'Ouverture de votre espace dans ' + reste + ' s…' : 'Ouverture de votre espace…';
          if (ecoule >= duree) { location.href = 'mon-espace.php'; return; }
          setTimeout(avancer, 50);
        };
        avancer();
      }
    })();
  </script>
</body>
</html>
