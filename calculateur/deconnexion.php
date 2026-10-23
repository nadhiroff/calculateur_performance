<?php

// Déconnexion : formulaire POST du menu (avec jeton), pour qu'un simple lien piégé ne puisse pas déconnecter.

use App\Auth;

require dirname(__DIR__).'/vendor/autoload.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && Auth::formulaireValide($_POST['csrf'] ?? null)) {
    Auth::deconnecter(($_POST['vers'] ?? '') === 'espace' ? 'agent' : 'admin');   // seul le rôle concerné est déconnecté
    if (($_POST['motif'] ?? '') === 'expiree') {
        // Inactivité (minuteur de la page) : retour à la connexion avec « session expirée », puis à la même page
        $retour = (string) ($_POST['retour'] ?? '');
        header('Location: connexion.php?expiree=1&retour='.rawurlencode(preg_match('/^(index|parametres)\.php(#[a-z0-9-]*)?$/', $retour) ? $retour : 'index.php'), true, 303);
        exit;
    }
    header('Location: '.(($_POST['vers'] ?? '') === 'espace' ? 'espace.php' : 'connexion.php').'?sortie=1', true, 303);   // commercial → son espace
    exit;
}

header('Location: index.php', true, 302);
