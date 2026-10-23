<?php

namespace App\Models;

use App\Db;

/** Calendrier / commissions d'un mois (table mensual_settings). Les RÈGLES de calcul sont dans « calcul_rules » (CalcRule). */
final class MensualSetting
{
    public static function existe(string $mois): bool
    {
        return Db::value('SELECT 1 FROM `mensual_settings` WHERE `mois` = ? LIMIT 1', [$mois]) !== null;
    }

    /** @return array<int, array{mois: string, objectifs_meta: array<string, mixed>|null}> triés par mois */
    public static function tous(): array
    {
        return array_map(static fn (array $r) => [
            'mois' => $r['mois'],
            'objectifs_meta' => $r['objectifs_meta'] === null ? null : json_decode((string) $r['objectifs_meta'], true),
        ], Db::select('SELECT `mois`, `objectifs_meta` FROM `mensual_settings` ORDER BY `mois`'));
    }

    /** @param array<string, mixed> $meta */
    public static function enregistrer(string $mois, array $meta): void
    {
        $now = Db::maintenant();
        Db::upsert('mensual_settings', [[
            'mois' => $mois, 'objectifs_meta' => json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'created_at' => $now, 'updated_at' => $now,
        ]], ['objectifs_meta', 'updated_at']);
    }

    /**
     * Supprime les mois absents de la liste (leurs objectifs partent en cascade SQL).
     *
     * @param  string[]  $moisGardes
     */
    public static function supprimerAbsents(array $moisGardes): void
    {
        $moisGardes = $moisGardes ?: [''];
        Db::executer('DELETE FROM `mensual_settings` WHERE `mois` NOT IN ('.Db::marques(count($moisGardes)).')', $moisGardes);
    }
}
