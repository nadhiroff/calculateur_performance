<?php
// Page réservée aux administrateurs connectés (sinon redirection vers connexion.php)
require dirname(__DIR__).'/vendor/autoload.php';
$admin = App\Auth::exiger('parametres.php');
$jeton = App\Auth::jeton();
// Paramètres est désormais une page de l'application (index.php#parametres) : plus de rechargement en y entrant ou en sortant.
// Cette adresse reste valable (favoris, liens) et redirige vers la page intégrée.
header('Location: index.php#parametres/obj', true, 302);
exit;
