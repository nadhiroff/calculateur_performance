<?php

namespace App\Services;

use App\Models\AppSetting;
use App\Models\CalcRule;
use App\Models\MensualObjective;
use App\Models\MensualSetting;
use App\Db;
use stdClass;

/**
 * Pont entre l'objet JS « état des paramètres » { version, periodes:{ 'AAAA-MM':{ objectifs, regles } }, partenaires }
 * et les tables MySQL : calendrier → mensual_settings, objectifs → mensual_objectives, RÈGLES et partenaires → calcul_rules.
 * Le JSON produit par exporter() a EXACTEMENT la forme attendue par le front : aucun module de calcul ni d'affichage n'est modifié.
 */
class ParametresSync
{
    /** @return array<string, mixed>|null  null si la base ne contient encore aucun mois */
    public function exporter(): ?array
    {
        $mois = MensualSetting::tous();
        if (! $mois) {
            return null;
        }
        $lignes = [];
        foreach (MensualObjective::lister() as $l) {
            $lignes[$l['mois']][] = $l;
        }

        $periodes = [];
        foreach ($mois as $m) {
            $objectifs = $m['objectifs_meta'] ?? [];
            $objectifs['equipes'] = ObjectifsMapper::versEquipes($lignes[$m['mois']] ?? []);
            $periodes[$m['mois']] = ['objectifs' => $objectifs, 'regles' => CalcRule::pourMois($m['mois']) ?? new stdClass()];
        }

        return [
            'version' => 1,
            'periodes' => $periodes,
            'partenaires' => CalcRule::partenaires() ?? new stdClass(),
        ];
    }

    /**
     * Sauvegarde COMPLÈTE de l'état. Idempotent : peut être rejoué sans effet de bord.
     *
     * @param  array<string, mixed>  $etat  état décodé en tableaux (objectifs, calendrier)
     * @param  object|null  $brut  MÊME état décodé en objets (json_decode sans assoc) : sert aux règles et partenaires pour préserver {} / []
     */
    public function importer(array $etat, ?object $brut = null): int
    {
        $brut ??= json_decode(json_encode($etat));

        return Db::transaction(function () use ($etat, $brut) {
            $periodes = $etat['periodes'] ?? [];

            foreach ($periodes as $mois => $p) {
                $objectifs = $p['objectifs'] ?? [];
                $equipes = $objectifs['equipes'] ?? [];
                unset($objectifs['equipes']);

                MensualSetting::enregistrer((string) $mois, $objectifs);

                $m = ObjectifsMapper::depuisEquipes($equipes);
                MensualObjective::appliquer((string) $mois, $m['lignes'], avecManuel: true, supprimerAbsentes: true);

                $regles = $brut->periodes->{$mois}->regles ?? null;
                if ($regles instanceof stdClass) {
                    CalcRule::ecrireMois((string) $mois, $regles);
                }
            }

            // Mois retirés dans l'écran Paramètres → supprimés (objectifs en cascade SQL, règles par purge)
            MensualSetting::supprimerAbsents(array_map('strval', array_keys($periodes)));
            CalcRule::purgerMoisAbsents(array_map('strval', array_keys($periodes)));

            if (($brut->partenaires ?? null) instanceof stdClass) {
                CalcRule::ecrirePartenaires($brut->partenaires);
            }

            return AppSetting::incrementerVersion();
        });
    }
}
