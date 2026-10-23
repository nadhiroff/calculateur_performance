<?php

namespace App;

use Throwable;

/** Journal d'erreurs : storage/logs/app.log (si le dossier est accessible en écriture), sinon journal PHP de l'hébergeur. */
final class Journal
{
    public static function exception(Throwable $e): void
    {
        self::ecrire('ERREUR', get_class($e).' : '.$e->getMessage().' ('.$e->getFile().':'.$e->getLine().")\n".$e->getTraceAsString());
    }

    public static function avertissement(string $message): void
    {
        self::ecrire('AVERTISSEMENT', $message);
    }

    private static function ecrire(string $niveau, string $message): void
    {
        $ligne = '['.date('Y-m-d H:i:s')."] $niveau : $message\n";
        $fichier = dirname(__DIR__).'/storage/logs/app.log';
        if (! @file_put_contents($fichier, $ligne, FILE_APPEND | LOCK_EX)) {
            error_log(rtrim($ligne));
        }
    }
}
