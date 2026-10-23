<?php

namespace App\Models;

use App\Db;
use App\Support\Cache;

/** Paramètres globaux clé/valeur (table app_settings) : version optimiste des paramètres, confirmations d'import en attente. */
final class AppSetting
{
    private const PREFIXE_ATTENTE = 'attente:';

    public static function lire(string $cle, mixed $defaut = null): mixed
    {
        $json = Db::value('SELECT `valeur` FROM `app_settings` WHERE `cle` = ?', [$cle]);
        $v = $json === null ? null : json_decode((string) $json, true);

        return $v ?? $defaut;
    }

    public static function ecrire(string $cle, mixed $valeur): void
    {
        $now = Db::maintenant();
        Db::upsert('app_settings', [[
            'cle' => $cle, 'valeur' => json_encode($valeur, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'created_at' => $now, 'updated_at' => $now,
        ]], ['valeur', 'updated_at']);
    }

    /** Numéro de version des paramètres : verrou optimiste (deux onglets / deux personnes ne s'écrasent pas en silence). */
    public static function version(): int
    {
        return (int) self::lire('params_version', 0);
    }

    public static function incrementerVersion(): int
    {
        $v = self::version() + 1;
        self::ecrire('params_version', $v);
        Cache::invalider();   // objectifs / règles / paramètres modifiés : résultats des commerciaux à recalculer

        return $v;
    }

    /** Met une donnée de côté pendant $minutes (ex. import d'objectifs en attente de confirmation). */
    public static function mettreDeCote(string $jeton, mixed $donnees, int $minutes): void
    {
        Db::executer('DELETE FROM `app_settings` WHERE `cle` LIKE ? AND `updated_at` < ?', [self::PREFIXE_ATTENTE.'%', date('Y-m-d H:i:s', time() - 86400)]);
        self::ecrire(self::PREFIXE_ATTENTE.$jeton, ['expire' => time() + $minutes * 60, 'donnees' => $donnees]);
    }

    /** Récupère ET supprime une donnée mise de côté ; null si absente ou expirée. */
    public static function reprendre(string $jeton): mixed
    {
        $cle = self::PREFIXE_ATTENTE.$jeton;
        $v = self::lire($cle);
        Db::executer('DELETE FROM `app_settings` WHERE `cle` = ?', [$cle]);

        return is_array($v) && ($v['expire'] ?? 0) >= time() ? $v['donnees'] : null;
    }
}
