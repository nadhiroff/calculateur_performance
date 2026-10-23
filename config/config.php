<?php

/*
|--------------------------------------------------------------------------
| config/config.php — CONFIGURATION DU SERVEUR (hébergement rgz.bj)
|--------------------------------------------------------------------------
| Fichier PHP ordinaire, à éditer par FTP. Jamais lisible depuis le web (bloqué par .htaccess).
|
| Sur votre PC : créez config/config.local.php (déjà fait) avec vos identifiants locaux. Ses valeurs remplacent celles-ci.
| Ce fichier config.local.php ne doit PAS être envoyé sur l'hébergement.
*/

return [

    /* ---------- Base de données MySQL / MariaDB (données par l'hébergeur) ---------- */
    'db' => [
        'host'      => 'localhost',
        'port'      => 3306,
        'database'  => 'celtiis',
        'username'  => 'admin',
        'password'  => 'Admin',
        'socket'    => '',                    // chemin du socket Unix si l'hébergeur l'impose (sinon laisser vide)
        'charset'   => 'utf8mb4',
        'collation' => 'utf8mb4_unicode_ci',
    ],

    /* ---------- Application ---------- */
    'app' => [
        'name'     => 'Calculateur Télécom',
        'debug'    => false,                  // true uniquement pour diagnostiquer : affiche le détail des erreurs
        'timezone' => 'UTC',
    ],

    /* ---------- Connexion des administrateurs (comptes dans la table « admins ») ---------- */
    'auth' => [
        'inactivite_minutes' => 30,           // administrateurs : déconnexion après 30 min sans activité
        'inactivite_agent_minutes' => 240,    // commerciaux (espace RGZ) : après 4 h sans activité
        'duree_max_heures'   => 12,           // reconnexion obligatoire au bout de 12 h, même en activité
        'tentatives_max'     => 5,            // échecs tolérés pour un même email avant blocage…
        'blocage_minutes'    => 15,           // …pendant 15 minutes
    ],

    /* ---------- Fichiers volumineux (Celtiis, Objectifs) ---------- */
    'uploads' => [
        'max_kb'             => 32768,        // taille max par fichier, en Ko (32768 = 32 Mo). null = aucune limite applicative
        'memory_limit'       => '1024M',      // mémoire PHP allouée à une requête d'import ('-1' = illimitée)
        'max_execution_time' => 0,            // secondes ; 0 = illimité
        'lot_lignes'         => 5000,         // lignes Excel lues/écrites par lot (réduire à 2000 si « Allowed memory size exhausted »)
    ],
];