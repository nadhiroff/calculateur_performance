<?php

namespace App\Services;

use App\Db;
use App\Support\Cache;

/**
 * Période affichée à l'arrivée (administration et espace commercial) : le mois le plus récent qui contient au moins un
 * JOUR OUVRÉ avec des données (calendrier du mois dans Paramètres), du 1er de ce mois à sa dernière date en base.
 * Un mois qui ne fait que commencer (ex. seul le dimanche 1er importé) ne vide plus l'écran : le mois précédent, complet,
 * est affiché jusqu'au premier jour ouvré importé. Les dates restent modifiables à la main.
 */
final class PeriodeDefaut
{
    /** @return array{du: string, au: string}|null null : base vide */
    public static function calculer(): ?array
    {
        return Cache::memoriser('periode-defaut:'.Cache::version(), 600, static function (): ?array {
            // Jours présents en base, du plus récent au plus ancien (quelques mois suffisent)
            $jours = array_column(Db::select('SELECT DISTINCT `jour` FROM `celtiis_datas` WHERE `jour` IS NOT NULL ORDER BY `jour` DESC LIMIT 400'), 'jour');
            if (! $jours) {
                return null;
            }
            $parMois = [];
            foreach ($jours as $j) {
                $parMois[substr((string) $j, 0, 7)][] = (string) $j;
            }
            foreach ($parMois as $mois => $liste) {
                $ouvres = array_map('intval', AgentTableau::parametres($mois)['calendrier']['ouvres'] ?? []);
                foreach ($liste as $j) {
                    if (in_array((int) substr($j, 8, 2), $ouvres, true)) {
                        return ['du' => $mois.'-01', 'au' => $liste[0]];   // $liste[0] : dernière date du mois en base
                    }
                }
            }
            $mois = array_key_first($parMois);   // aucun jour ouvré nulle part : mois le plus récent, comme avant

            return ['du' => $mois.'-01', 'au' => $parMois[$mois][0]];
        });
    }
}
