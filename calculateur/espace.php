<?php

/*
| Espace commercial RGZ : login Celtiis (logins présents dans les objectifs RGZ) PUIS code personnel à 4 chiffres.
| 1re connexion : le commercial choisit son code (tapé deux fois). Ensuite : login + code. Code oublié : l'administrateur le
| réinitialise (Paramètres › Utilisateurs) et il en choisit un nouveau. Faute de frappe sur le login → logins proches proposés
| (sans le code, ils ne donnent accès à rien). Code bon → félicitations + équipe, puis mon-espace.php.
*/

use App\Auth;
use App\Config;
use App\Journal;
use App\Services\AgentAnnuaire;
use App\Services\AgentCode;
use App\Support\Contact;

require dirname(__DIR__).'/vendor/autoload.php';

date_default_timezone_set((string) Config::get('app.timezone', 'UTC'));
ini_set('display_errors', '0');
mb_internal_encoding('UTF-8');
header('Cache-Control: no-store, private');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$etat = 'formulaire';   // formulaire | proches | inconnu | code | creer | succes
$message = null;
$saisie = '';
$trouve = null;      // login reconnu (étapes code / creer / succes)
$proches = [];
$nouveauCode = false;
$bloque = 0;         // minutes de blocage du login (trop de codes faux)
$reinitLe = null;    // code effacé par l'administrateur : date affichée à l'écran « Choisissez votre code »
$annonceReinit = false;   // alerte « code réinitialisé » : une seule fois, juste après la saisie du login
try {
    $post = $_SERVER['REQUEST_METHOD'] === 'POST';
    // Page affichée juste après un envoi (POST → redirection → GET) : on reprend son résultat
    $resultat = $post ? null : Auth::lireResultat();
    if ($resultat !== null) {
        ['etat' => $etat, 'message' => $message, 'saisie' => $saisie, 'proches' => $proches, 'nouveau' => $nouveauCode, 'bloque' => $bloque] = $resultat;
        $annonceReinit = (bool) ($resultat['annonce'] ?? false);
    }
    $agentConnecte = $post ? null : Auth::agent();
    if ($etat === 'succes') {
        $trouve = $agentConnecte;   // félicitations : une seule fois, juste après la connexion
        $etat = $trouve !== null ? 'succes' : 'formulaire';
    } elseif (! $post && ! isset($_GET['sortie']) && $agentConnecte !== null) {
        header('Location: mon-espace.php', true, 302);
        exit;
    }
    if (isset($_GET['changer'])) {
        Auth::retenirLogin(null);   // « Ce n'est pas moi » : retour à la saisie du login
    }
    $attente = isset($_GET['changer']) ? null : Auth::loginRetenu();
    // Étape du code (créer ou taper) pour le login reconnu
    $etapeCode = static fn (array $l): string => AgentCode::lire($l['cle']) === null ? 'creer' : 'code';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $etape = (string) ($_POST['etape'] ?? 'login');
        if (! Auth::formulaireValide($_POST['csrf'] ?? null)) {
            $message = 'La page a expiré : réessayez.';
            if ($attente !== null && $etape !== 'login') {
                $trouve = $attente;
                $etat = $etapeCode($attente);
            }
        } elseif ($etape === 'code' || $etape === 'creer') {
            if ($attente === null) {
                $message = 'Le temps pour taper votre code est dépassé (10 minutes). Saisissez à nouveau votre login.';
            } else {
                $trouve = $attente;
                $etat = $etapeCode($attente);
                $code = (string) ($_POST['code'] ?? '');
                if ($etat === 'creer' && $etape === 'creer') {
                    $message = AgentCode::refus($code, (string) ($_POST['confirmation'] ?? ''));
                    if ($message === null) {
                        $le = AgentCode::creer($trouve['cle'], $trouve['login'], $code);
                        if ($le === null) {
                            $etat = 'code';
                            $message = 'Un code a déjà été choisi pour ce login. Tapez-le ci-dessous.';
                        } else {
                            Auth::connecterAgent($trouve, $le);
                            $etat = 'succes';
                            $nouveauCode = true;
                        }
                    }
                } elseif ($etat === 'code' && $etape === 'code') {
                    $bloque = AgentCode::minutesDeBlocage($trouve['cle']);
                    if ($bloque === 0) {
                        $le = AgentCode::verifier($trouve['cle'], $code);
                        if ($le !== null) {
                            Auth::connecterAgent($trouve, $le);
                            $etat = 'succes';
                        } else {
                            $restants = AgentCode::essaisRestants($trouve['cle']);
                            $bloque = $restants === 0 ? AgentCode::minutesDeBlocage($trouve['cle']) : 0;
                            if ($bloque === 0) {
                                $message = 'Code incorrect. Il vous reste '.$restants.' essai'.($restants > 1 ? 's' : '').'.';
                            }
                        }
                    }
                }
            }
        } else {
            $saisie = trim((string) ($_POST['login'] ?? ''));
            $minutes = Auth::minutesDeBlocageAgent();
            if ($minutes > 0) {
                $message = 'Trop de logins inconnus saisis. Réessayez dans '.$minutes.' minute'.($minutes > 1 ? 's' : '').'.';
            } elseif ($saisie === '') {
                $message = 'Saisissez votre login.';
            } else {
                $r = AgentAnnuaire::chercher($saisie);
                if ($r['exact'] !== null) {
                    $trouve = $r['exact'];
                    Auth::retenirLogin($trouve);
                    $etat = $etapeCode($trouve);
                    $annonceReinit = $etat === 'creer';   // affichée si son code vient d'être réinitialisé (voir plus bas)
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
    } elseif ($attente !== null && ! isset($_GET['sortie']) && in_array($etat, ['formulaire', 'code', 'creer'], true)) {
        $trouve = $attente;   // étape du code (après un envoi, ou page actualisée) : on y reste
        $etat = $etapeCode($attente);
    } elseif ($etat === 'code' || $etat === 'creer') {
        $etat = 'formulaire';   // login en attente expiré (10 min) : retour à la saisie du login
    }
    if ($post) {
        // Envoi traité : résultat gardé en session puis redirection. Actualiser la page ne renvoie donc jamais le formulaire.
        Auth::retenirResultat(['etat' => $etat, 'message' => $message, 'saisie' => $saisie, 'proches' => $proches, 'nouveau' => $nouveauCode, 'bloque' => $bloque, 'annonce' => $annonceReinit]);
        header('Location: espace.php', true, 303);
        exit;
    }
    if ($etat === 'creer' && $trouve !== null && ($le = AgentCode::reinitialiseLe($trouve['cle'])) !== null) {
        $jour = date('Y-m-d', (int) strtotime($le));
        $reinitLe = $jour === date('Y-m-d') ? 'aujourd\'hui' : ($jour === date('Y-m-d', strtotime('-1 day')) ? 'hier' : 'le '.date('d/m/Y', (int) strtotime($le)));
    }
    if ($bloque > 0) {
        $message = 'Trop de codes faux : ce login est bloqué pendant '.$bloque.' minute'.($bloque > 1 ? 's' : '').'. Code oublié ? Appuyez sur le bouton WhatsApp en bas de la page.';
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
$codeReinit = isset($_GET['reinit']) && $_SERVER['REQUEST_METHOD'] !== 'POST';   // déconnecté par la réinitialisation de son code
$waLien = Contact::whatsappLien($trouve !== null && in_array($etat, ['code', 'creer'], true)
    ? 'Bonjour, j\'ai oublié mon code de l\'espace commercial RGZ. Mon login : '.$trouve['login']
    : 'Bonjour, j\'ai besoin d\'aide pour me connecter à l\'espace commercial RGZ.');
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

    /* Étapes du code : login rappelé, champ à 4 chiffres, consignes */
    .qui-login { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); margin: 0 0 14px; font-size: .8125rem; }
    .qui-login b { display: block; color: var(--text); word-break: break-all; font-size: .9rem; }
    .qui-login small { color: var(--text-3); }
    .qui-login a { margin-left: auto; flex: none; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--primary-600); font-weight: 600; font-size: .78rem; text-decoration: none; transition: background var(--t-fast), border-color var(--t-fast); }
    .qui-login a:hover, .qui-login a:focus-visible { text-decoration: none; background: var(--primary-soft); border-color: var(--primary-600); outline: none; }
    .saisie input.pin { padding: 0 52px 0 42px; font-size: 1.5rem; letter-spacing: .6em; font-variant-numeric: tabular-nums; }
    .saisie input.pin::placeholder { letter-spacing: .4em; color: var(--text-3); }
    /* Œil : afficher / masquer le code tapé, sur chaque ligne */
    .saisie .voir { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 44px; height: 40px; border: 0; border-radius: 10px; background: transparent; color: var(--text-3); cursor: pointer; display: grid; place-items: center; }
    .saisie .voir i { position: static; transform: none; color: inherit; font-size: 1rem; }
    .saisie .voir:hover, .saisie .voir:focus-visible { color: var(--primary-600); background: var(--primary-soft); outline: none; }
    .saisie .voir[aria-pressed="true"] { color: var(--primary-600); }
    .champ + .champ { margin-top: 12px; }
    .consignes { margin: 0 0 14px; padding: 12px 14px; border-radius: 12px; background: var(--info-soft); color: var(--info-text); font-size: .8125rem; line-height: 1.5; }
    .consignes p { margin: 0 0 6px; }
    .consignes ol { margin: 0; padding-left: 18px; }
    .consignes li + li { margin-top: 2px; }
    .oubli { margin: 12px 0 0; font-size: .78rem; color: var(--text-3); line-height: 1.5; text-align: center; }
    .oubli a { color: #128C4A; font-weight: 700; }
    body.etape-code .coche { width: clamp(52px, 8vh, 76px); height: clamp(52px, 8vh, 76px); margin-bottom: clamp(6px, 1.4vh, 14px); }
    body.etape-code .succes h2 { font-size: clamp(1.2rem, 3vh, 1.5rem); }
    body.etape-code .succes .qui { margin: clamp(4px, 1vh, 10px) 0 4px; }
    body.etape-code .equipe { margin-top: clamp(4px, 1vh, 10px); padding: 6px 12px; }
    body.etape-code .redirection { margin-top: clamp(10px, 1.8vh, 16px); }
    .succes .retenez { margin: clamp(8px, 1.4vh, 12px) 0 0; padding: 10px 12px; border-radius: 12px; background: #FEF5E1; color: #7A4706; font-size: .8125rem; line-height: 1.45; text-align: left; }

    /* Contact : logo RGZ + logo WhatsApp + numéro, toujours visible sous la carte */
    .pied { width: 100%; max-width: 420px; text-align: center; }
    .whatsapp { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 16px; background: #fff; color: #0B1B3A; text-decoration: none; text-align: left;
      border: 1px solid rgba(255,255,255,.6); transition: background var(--t-fast); }
    .whatsapp:hover, .whatsapp:focus-visible { background: #ECFDF3; outline: none; }
    .whatsapp .logos { display: flex; align-items: center; flex: none; }
    .whatsapp .logos img { width: 38px; height: 38px; border-radius: 10px; border: 1px solid #E3E8F2; }
    .whatsapp .logos i { width: 38px; height: 38px; margin-left: -8px; border-radius: 50%; display: grid; place-items: center; background: #25D366; color: #fff; font-size: 1.35rem; border: 2px solid #fff; }
    .whatsapp span.txt { min-width: 0; }
    .whatsapp small { display: block; font-size: .72rem; color: #4A5878; }
    .whatsapp b { display: block; font-size: 1rem; letter-spacing: .01em; white-space: nowrap; }
    .whatsapp .fleche-wa { margin-left: auto; color: #128C4A; font-size: .85rem; }

    @keyframes apparaitre { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes secouer { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(2px); } 30%, 50%, 70% { transform: translateX(-4px); } 40%, 60% { transform: translateX(4px); } }
    @keyframes tourner { to { transform: rotate(360deg); } }
    @keyframes bondir { from { transform: scale(.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    @keyframes tracer { to { stroke-dashoffset: 0; } }
    @keyframes tomber { to { transform: translateY(110vh) rotate(720deg); } }

    @media (max-height: 640px) { .tete p, .astuce { display: none; } .tete .eyebrow { display: none; } }
    /* Étapes du code : tout tient dans l'écran, sans barre de défilement. La présentation se réduit au logo (ordinateur)
       ou disparaît (téléphone, le login est rappelé dans la carte) ; espacements proportionnels à la hauteur ; consignes
       raccourcies puis masquées sur les écrans courts. Le bouton WhatsApp reste toujours visible. */
    body.etape-code { gap: clamp(10px, 2.2vh, 20px); padding-top: clamp(10px, 2.4vh, 28px); padding-bottom: clamp(10px, 2.4vh, 28px); }
    body.etape-code .tete h1, body.etape-code .tete p { display: none; }
    body.etape-code .tete img { width: clamp(36px, 5.6vh, 48px); height: clamp(36px, 5.6vh, 48px); }
    body.etape-code .tete .eyebrow { margin-top: 6px; }
    @media (max-width: 700px) { body.etape-code .tete { display: none; } }
    body.etape-code .carte { padding: clamp(14px, 2.6vh, 24px) clamp(16px, 5vw, 26px); }
    body.etape-code .carte h2 { margin-bottom: clamp(6px, 1.2vh, 10px); }
    body.etape-code .qui-login { padding: 8px 10px; margin-bottom: clamp(8px, 1.6vh, 14px); }
    body.etape-code .consignes { padding: clamp(8px, 1.4vh, 12px) 12px; margin-bottom: clamp(8px, 1.6vh, 14px); font-size: .78rem; line-height: 1.45; }
    body.etape-code .champ + .champ { margin-top: clamp(6px, 1.2vh, 12px); }
    body.etape-code label { margin-bottom: 4px; }
    body.etape-code .bouton { margin-top: clamp(10px, 1.8vh, 16px); }
    body.etape-code .oubli { margin-top: clamp(8px, 1.4vh, 12px); }
    body.etape-code .whatsapp { padding: clamp(6px, 1.2vh, 10px) 14px; }
    @media (max-height: 760px) { body.etape-code .consignes ol { display: none; } body.etape-code .consignes p { margin: 0; } }
    @media (max-height: 600px) { body.etape-code .consignes, body.etape-code .carte .sous { display: none; } }
    /* Très petits écrans (≤ 520 px de haut) : l'alerte « code réinitialisé » tient sur une ligne et remplace le titre */
    @media (max-height: 520px) {
      body.etape-code .alerte .suite, body.etape-code h2.apres-reinit, body.etape-code .qui-login small { display: none; }
      body.etape-code .alerte { padding: 8px 10px; margin-bottom: 8px; }
      body.etape-code .saisie input { height: 42px; }
      body.etape-code .bouton { height: 44px; }
    }
    /* Filet de sécurité (très petit écran, clavier ouvert) : la page peut glisser, mais aucune barre n'est affichée */
    html, body { scrollbar-width: none; }
    html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; }
    html:has(body.etape-code), body.etape-code { overflow-y: auto; }
    body.etape-code { height: auto; min-height: 100vh; min-height: 100dvh; }
    /* Mode « clavier » (téléphone, champ login touché) : présentation et pied masqués, carte en haut de l'écran.
       Le champ reste visible au-dessus du clavier sans que la page ait à défiler ; tout revient quand le clavier se ferme. */
    body.clavier { justify-content: flex-start; padding-top: calc(14px + env(safe-area-inset-top, 0px)); }
    body.clavier .tete { display: none; }
    /* Clavier ouvert : le bouton WhatsApp reste visible, en version compacte, juste sous la carte */
    body.clavier .pied small { display: none; }
    body.clavier .whatsapp { padding: 6px 12px; }
    body.clavier .whatsapp .logos img, body.clavier .whatsapp .logos i { width: 30px; height: 30px; }
    body.clavier .whatsapp .logos i { font-size: 1.05rem; }
    body.clavier .whatsapp b { font-size: .9rem; }
    @media (max-height: 380px) { body.clavier .carte .sous, body.clavier .carte .astuce { display: none; } body.clavier .carte h2 { margin-bottom: 8px; } }
    html:has(body.clavier), body.clavier { overflow-y: auto; }   /* très petit écran : la page glisse (barre masquée), le bouton reste atteignable */
    body.clavier { height: auto; min-height: 100vh; min-height: 100dvh; }
    body.clavier .carte { animation: none; }
    @media (max-height: 540px) { .tete { display: none; } .pied small { display: none; } .whatsapp { padding: 6px 14px; } }
    @media (max-height: 420px) { html, body { overflow: auto; } body { height: auto; min-height: 100dvh; justify-content: flex-start; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition: none !important; } }
  </style>
</head>
<body<?= in_array($etat, ['code', 'creer', 'succes'], true) ? ' class="etape-code"' : '' ?>>
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
      <?php if ($nouveauCode): ?>
        <p class="retenez"><i class="fa-solid fa-key" aria-hidden="true"></i> <b>Votre code est enregistré.</b> Retenez-le bien : il vous sera demandé à chaque connexion, avec votre login. Ne le donnez à personne.</p>
      <?php endif; ?>
      <a class="bouton" href="mon-espace.php" id="continuer">Voir mes résultats<i class="fa-solid fa-arrow-right fleche" aria-hidden="true"></i></a>
      <div class="redirection" aria-hidden="true" data-duree="<?= $nouveauCode ? 7000 : 4000 ?>"><span id="barre"></span></div>
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

  <?php elseif ($etat === 'code' || $etat === 'creer'): ?>
    <?php if ($message !== null): ?>
      <div class="alerte neg<?= $bloque > 0 ? ' persistante' : '' ?>" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span><?= $e($message) ?></span></div>
    <?php endif; ?>
    <div class="qui-login">
      <i class="fa-solid fa-id-badge" aria-hidden="true"></i>
      <span><b><?= $e($trouve['login']) ?></b><small>Équipe <?= $e($trouve['equipe']) ?></small></span>
      <a href="espace.php?changer=1">Ce n'est pas moi</a>
    </div>
    <?php if ($etat === 'creer'): ?>
      <?php if ($reinitLe !== null && $annonceReinit): ?>
        <div class="alerte info" role="status"><i class="fa-solid fa-rotate" aria-hidden="true"></i><span><b>Votre code a été réinitialisé <?= $e($reinitLe) ?>.</b><span class="suite"> Votre ancien code ne marche plus : choisissez-en un nouveau ci-dessous.</span></span></div>
      <?php endif; ?>
      <h2<?= $reinitLe !== null ? ' class="apres-reinit"' : '' ?>><?= $reinitLe !== null ? 'Choisissez votre nouveau code' : 'Choisissez votre code secret' ?></h2>
      <div class="consignes">
        <?php if ($reinitLe !== null): ?>
          <p><b>Nouveau code :</b> 4 chiffres. Sans lui, personne ne peut ouvrir votre espace.</p>
        <?php else: ?>
          <p><b>Première connexion :</b> choisissez un code de 4 chiffres. Sans lui, personne ne peut ouvrir votre espace.</p>
        <?php endif; ?>
        <ol>
          <li>Tapez 4 chiffres faciles à retenir <b>pour vous</b>, puis retapez-les.</li>
          <li>Ne donnez ce code à personne, même à un collègue.</li>
        </ol>
      </div>
      <form method="post" action="espace.php" class="form-code" novalidate>
        <input type="hidden" name="csrf" value="<?= $e($jeton) ?>"><input type="hidden" name="etape" value="creer">
        <input type="text" name="username" value="<?= $e($trouve['login']) ?>" autocomplete="username" hidden>
        <div class="champ">
          <label for="code">Nouveau code (4 chiffres)</label>
          <div class="saisie"><i class="fa-solid fa-key" aria-hidden="true"></i><input class="pin" type="password" id="code" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="••••" autocomplete="new-password" required><button type="button" class="voir" aria-label="Afficher le code" aria-pressed="false" title="Afficher le code"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>
        </div>
        <div class="champ">
          <label for="confirmation">Retapez le même code</label>
          <div class="saisie"><i class="fa-solid fa-key" aria-hidden="true"></i><input class="pin" type="password" id="confirmation" name="confirmation" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="••••" autocomplete="new-password" required><button type="button" class="voir" aria-label="Afficher le code" aria-pressed="false" title="Afficher le code"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>
        </div>
        <p class="astuce">Refusés : 0000, 1111, 1234 et les codes de ce genre.</p>
        <button type="submit" class="bouton"><span class="roue" aria-hidden="true"></span>Enregistrer mon code et entrer<i class="fa-solid fa-arrow-right fleche" aria-hidden="true"></i></button>
      </form>
    <?php else: ?>
      <h2>Tapez votre code</h2>
      <p class="sous">Le code secret de 4 chiffres que vous avez choisi à votre première connexion.</p>
      <form method="post" action="espace.php" class="form-code" data-auto="1" novalidate>
        <input type="hidden" name="csrf" value="<?= $e($jeton) ?>"><input type="hidden" name="etape" value="code">
        <input type="text" name="username" value="<?= $e($trouve['login']) ?>" autocomplete="username" hidden>
        <label for="code">Votre code (4 chiffres)</label>
        <div class="saisie"><i class="fa-solid fa-lock" aria-hidden="true"></i><input class="pin" type="password" id="code" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="••••" autocomplete="current-password" required<?= $bloque > 0 ? ' disabled' : '' ?>><button type="button" class="voir" aria-label="Afficher le code" aria-pressed="false" title="Afficher le code"><i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>
        <button type="submit" class="bouton"<?= $bloque > 0 ? ' disabled' : '' ?>><span class="roue" aria-hidden="true"></span>Entrer dans mon espace<i class="fa-solid fa-arrow-right fleche" aria-hidden="true"></i></button>
      </form>
      <p class="oubli">Au 4e chiffre, votre espace s'ouvre tout seul.</p>
    <?php endif; ?>

  <?php else: ?>
    <?php if ($etat === 'inconnu'): ?>
      <div class="alerte neg" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>Le login « <?= $e($saisie) ?> » n'est pas reconnu. Vérifiez-le : c'est celui écrit sur vos ventes.</span></div>
    <?php elseif ($message !== null): ?>
      <div class="alerte neg" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span><?= $e($message) ?></span></div>
    <?php elseif ($sortie): ?>
      <div class="alerte pos" role="status"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Vous êtes déconnecté. À bientôt !</span></div>
    <?php elseif ($codeReinit): ?>
      <div class="alerte info" role="status"><i class="fa-solid fa-rotate" aria-hidden="true"></i><span><b>Votre code a été réinitialisé</b> : vous avez été déconnecté. Tapez votre login, puis choisissez un nouveau code.</span></div>
    <?php elseif ($expiree): ?>
      <div class="alerte info" role="status"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>Votre session a expiré : saisissez à nouveau votre login et votre code.</span></div>
    <?php endif; ?>
    <h2>Identifiez-vous</h2>
    <p class="sous">Étape 1 : votre login Celtiis, celui qui apparaît sur vos ventes. Étape 2 : votre code secret à 4 chiffres.</p>
    <form method="post" action="espace.php" id="form-login" novalidate>
      <input type="hidden" name="csrf" value="<?= $e($jeton) ?>">
      <label for="login">Votre login</label>
      <div class="saisie">
        <i class="fa-solid fa-id-badge" aria-hidden="true"></i>
        <input type="text" id="login" name="login" value="<?= $e($saisie) ?>" placeholder="ex. pvt_rgz_monlogin" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      </div>
      <p class="astuce">Majuscules, tirets ou « .ftth » : pas d'importance.</p>
      <button type="submit" class="bouton" id="bouton"><span class="roue" aria-hidden="true"></span>Continuer<i class="fa-solid fa-arrow-right fleche" aria-hidden="true"></i></button>
    </form>
  <?php endif; ?>
  </main>

  <footer class="pied">
    <a class="whatsapp" href="<?= $e($waLien) ?>" target="_blank" rel="noopener" aria-label="Demander de l'aide sur WhatsApp">
      <span class="logos" aria-hidden="true"><img src="assets/img/logoRGZ-128.png" alt="" width="38" height="38"><i class="fa-brands fa-whatsapp"></i></span>
      <span class="txt"><small>Un problème de login ou de code ?</small><b>Écrivez-nous sur WhatsApp</b></span>
      <i class="fa-solid fa-chevron-right fleche-wa" aria-hidden="true"></i>
    </a>
  </footer>

  <script>
    (function () {
      'use strict';
      // Clavier du téléphone : la carte remonte (présentation masquée) tant que le clavier est ouvert, puis tout revient en place.
      // Fermeture détectée par la perte du focus ET par le retour à la hauteur d'écran (bouton « retour » Android, focus conservé).
      const champs = Array.from(document.querySelectorAll('.carte input:not([type=hidden]):not([hidden])'));
      const tactile = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 900px)').matches;
      if (champs.length && tactile) {
        const vv = window.visualViewport;
        let hauteurPleine = Math.max(window.innerHeight, vv ? vv.height : 0);
        const actif = () => champs.includes(document.activeElement);
        const remettre = () => { if (actif()) return; document.body.classList.remove('clavier'); window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; };
        champs.forEach((c) => {
          c.addEventListener('focus', () => { document.body.classList.add('clavier'); window.scrollTo(0, 0); });
          c.addEventListener('blur', () => setTimeout(remettre, 150));   // passage d'un champ à l'autre : la carte reste en haut
        });
        if (vv) vv.addEventListener('resize', () => {
          hauteurPleine = Math.max(hauteurPleine, vv.height, document.body.classList.contains('clavier') ? 0 : window.innerHeight);
          if (vv.height > hauteurPleine * 0.85) { if (actif()) document.activeElement.blur(); document.body.classList.remove('clavier'); window.scrollTo(0, 0); }   // clavier fermé
          else if (actif()) window.scrollTo(0, 0);
        });
        window.addEventListener('orientationchange', () => setTimeout(() => { hauteurPleine = 0; remettre(); }, 300));
      }
      const grandEcran = window.matchMedia('(min-width: 700px)').matches;   // pas de clavier qui surgit sur téléphone

      const form = document.getElementById('form-login');
      if (form) {
        const champ = document.getElementById('login');
        if (!champ.value && grandEcran) champ.focus();
        form.addEventListener('submit', (e) => { if (!champ.value.trim()) { e.preventDefault(); champ.focus(); return; } document.getElementById('bouton').classList.add('charge'); });
      }

      // Code à 4 chiffres : chiffres seulement ; « Tapez votre code » part tout seul au 4e chiffre ; création : passage au 2e champ
      document.querySelectorAll('.form-code').forEach((f) => {
        const pins = Array.from(f.querySelectorAll('input.pin')), bouton = f.querySelector('button[type=submit]');
        let parti = false;
        const envoyer = () => { if (parti) return; parti = true; bouton.classList.add('charge'); f.submit(); };
        if (grandEcran && pins[0] && !pins[0].disabled) pins[0].focus();
        // Œil : affiche le code en clair (ou le masque à nouveau) sur sa ligne, sans perdre la saisie ni le clavier
        f.querySelectorAll('.voir').forEach((b) => {
          const c = b.parentNode.querySelector('input.pin');
          if (c.disabled) b.disabled = true;
          b.addEventListener('mousedown', (e) => e.preventDefault());   // le champ garde le focus (clavier du téléphone ouvert)
          b.addEventListener('click', () => {
            const visible = c.type === 'password';
            c.type = visible ? 'text' : 'password';
            b.setAttribute('aria-pressed', String(visible));
            b.setAttribute('aria-label', visible ? 'Masquer le code' : 'Afficher le code'); b.title = b.getAttribute('aria-label');
            b.firstElementChild.className = 'fa-solid ' + (visible ? 'fa-eye-slash' : 'fa-eye');
          });
        });
        pins.forEach((c, i) => c.addEventListener('input', () => {
          const net = c.value.replace(/\D+/g, '').slice(0, 4);
          if (net !== c.value) c.value = net;
          if (net.length < 4) return;
          if (pins[i + 1]) pins[i + 1].focus();
          else if (f.dataset.auto) envoyer();
        }));
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const vide = pins.find((c) => c.value.length !== 4);
          if (vide) { vide.focus(); return; }
          envoyer();
        });
      });
      // Messages : disparition automatique ; paramètres retirés de l'adresse
      // Erreurs (rouge) : 6 s pour avoir le temps de lire ; sauf « login bloqué », qui reste (le champ du code est désactivé)
      document.querySelectorAll('.alerte:not(.persistante)').forEach((a) => setTimeout(() => {
        a.style.overflow = 'hidden'; a.style.maxHeight = a.offsetHeight + 'px';
        a.style.transition = 'opacity .3s, max-height .35s .2s, margin .35s .2s, padding .35s .2s';
        requestAnimationFrame(() => { a.style.opacity = '0'; a.style.maxHeight = '0'; a.style.marginBottom = '0'; a.style.paddingTop = '0'; a.style.paddingBottom = '0'; });
        setTimeout(() => a.remove(), 600);   // la carte se resserre en douceur, sans saut
      }, a.classList.contains('pos') ? 5000 : 6000));   // erreurs et informations : 6 s pour lire
      if (/[?&](sortie|expiree|reinit)=/.test(location.search)) history.replaceState(null, '', location.pathname);

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
        const barre = document.getElementById('barre'), compte = document.getElementById('compte');
        const duree = Number(barre.parentNode.dataset.duree) || 4000, debut = Date.now();
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
