<?php

namespace App;

use App\Models\CalcRule;
use PDOException;
use stdClass;

/**
 * Installation automatique : si une table manque (erreur SQL 1146), database/schema.sql est exécuté
 * (CREATE TABLE IF NOT EXISTS : aucune donnée existante n'est touchée), puis les règles par défaut sont chargées
 * si la base n'en contient aucune. Plus besoin de lancer de commande sur l'hébergement.
 */
final class Installer
{
    public static function tableManquante(PDOException $e): bool
    {
        return ($e->errorInfo[1] ?? null) === 1146;
    }

    public static function installer(): void
    {
        $sql = (string) file_get_contents(dirname(__DIR__).'/database/schema.sql');
        $sql = (string) preg_replace('/^\s*--.*$/m', '', $sql);
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $instruction) {
            Db::pdo()->exec($instruction);
        }
        self::reglesParDefaut();
    }

    /** Règles livrées avec le front (calculateur/config/*.json), chargées seulement si aucune n'existe encore. */
    private static function reglesParDefaut(): void
    {
        $dossier = dirname(__DIR__).'/calculateur/config';

        $regles = self::lire($dossier.'/regles_defaut.json');
        if ($regles !== null && ! CalcRule::moisDisponibles()) {
            CalcRule::ecrireMois((string) ($regles->periode ?? date('Y-m')), $regles);
        }

        $partenaires = self::lire($dossier.'/partenaires_defaut.json');
        if ($partenaires !== null && CalcRule::partenaires() === null) {
            CalcRule::ecrirePartenaires($partenaires);
        }
    }

    private static function lire(string $fichier): ?stdClass
    {
        $j = is_file($fichier) ? json_decode((string) file_get_contents($fichier)) : null;

        return $j instanceof stdClass ? $j : null;
    }
}
