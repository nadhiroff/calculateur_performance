<?php

namespace App\Support;

use App\Db;
use Throwable;

/**
 * Cache sur fichiers (storage/cache), sans extension PHP particulière : fonctionne sur tout hébergement mutualisé.
 *
 * Utilisé pour les calculs communs à tous les commerciaux (ventes de tout RGZ par jour, champion, rangs) :
 * calculés une fois puis relus par les suivants. Les clés incluent version() : un import, un ajout manuel ou une
 * modification des paramètres change la version, donc le cache se renouvelle tout seul.
 * Si le dossier n'est pas accessible en écriture, le calcul est simplement refait à chaque fois (aucune erreur).
 */
final class Cache
{
    private static ?string $version = null;

    /**
     * Valeur en cache, ou calculée par $fn puis enregistrée. Un verrou évite que 50 visiteurs simultanés
     * lancent 50 fois le même calcul quand le cache vient d'expirer : le premier calcule, les autres attendent puis relisent.
     *
     * @template T
     *
     * @param  callable(): T  $fn  résultat sérialisable en JSON
     * @return T
     */
    public static function memoriser(string $cle, int $secondes, callable $fn): mixed
    {
        $dossier = self::dossier();
        if ($dossier === null) {
            return $fn();
        }
        $fichier = $dossier.'/'.hash('sha1', $cle).'.json';
        $lu = self::lire($fichier, $secondes);
        if ($lu !== null) {
            return $lu;
        }

        $verrou = @fopen($fichier.'.lock', 'c');
        if ($verrou === false) {
            return $fn();
        }
        try {
            flock($verrou, LOCK_EX);
            $lu = self::lire($fichier, $secondes);   // calculé entre-temps par un autre visiteur
            if ($lu !== null) {
                return $lu;
            }
            $valeur = $fn();
            $tmp = $fichier.'.'.bin2hex(random_bytes(4)).'.tmp';
            if (@file_put_contents($tmp, json_encode($valeur, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION)) !== false) {
                @rename($tmp, $fichier);   // écriture atomique : un lecteur ne voit jamais un fichier à moitié écrit
            }
            if (random_int(1, 50) === 1) {
                self::nettoyer($dossier);
            }

            return $valeur;
        } finally {
            flock($verrou, LOCK_UN);
            fclose($verrou);
        }
    }

    /**
     * Empreinte de l'état des données, lue dans storage/cache/version : une page servie depuis le cache n'ouvre ainsi
     * AUCUNE connexion MySQL (les hébergements mutualisés limitent le nombre de connexions simultanées).
     * Renouvelée par invalider() à chaque import, ajout manuel ou modification des paramètres. Sans dossier accessible
     * en écriture : empreinte calculée en base (dernier import, dernière souscription, version des paramètres).
     */
    public static function version(): string
    {
        if (self::$version !== null) {
            return self::$version;
        }
        $dossier = self::dossier();
        $fichier = $dossier === null ? null : $dossier.'/version';
        $v = $fichier === null ? false : @file_get_contents($fichier);
        if ($v === false || $v === '') {
            $v = $fichier !== null && self::invalider() ? (string) @file_get_contents($fichier) : '';
        }

        return self::$version = $v !== '' ? $v : 'db-'.implode('-', array_map('strval', Db::first(
            "SELECT (SELECT MAX(`id`) FROM `imports`) AS i, (SELECT MAX(`id`) FROM `celtiis_datas`) AS c,"
            ." (SELECT `valeur` FROM `app_settings` WHERE `cle` = 'params_version') AS p"
        ) ?? []));
    }

    /** Les données ont changé : nouvelle version, tous les résultats en cache seront recalculés à la prochaine visite. */
    public static function invalider(): bool
    {
        self::$version = null;
        $dossier = self::dossier();
        if ($dossier === null) {
            return false;
        }
        $tmp = $dossier.'/version.'.bin2hex(random_bytes(4)).'.tmp';

        return @file_put_contents($tmp, date('YmdHis').'-'.bin2hex(random_bytes(6))) !== false && @rename($tmp, $dossier.'/version');
    }

    private static function lire(string $fichier, int $secondes): mixed
    {
        $t = @filemtime($fichier);
        if ($t === false || time() - $t > $secondes) {
            return null;
        }
        $json = @file_get_contents($fichier);

        return $json === false ? null : json_decode($json, true);
    }

    /** Fichiers de plus d'un jour supprimés (anciennes versions, anciennes périodes). */
    private static function nettoyer(string $dossier): void
    {
        foreach (glob($dossier.'/*') ?: [] as $f) {
            if (basename($f) !== 'version' && @filemtime($f) < time() - 86400) {
                @unlink($f);
            }
        }
    }

    private static function dossier(): ?string
    {
        $d = dirname(__DIR__, 2).'/storage/cache';
        try {
            if (! is_dir($d) && ! @mkdir($d, 0775, true)) {
                return null;
            }
        } catch (Throwable) {
            return null;
        }

        return is_writable($d) ? $d : null;
    }
}
