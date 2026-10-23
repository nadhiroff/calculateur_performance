<?php

namespace App\Controllers;

use App\Db;
use App\Http\Request;
use App\Http\Response;
use App\Http\Valider;
use App\Models\Import;

/**
 * Vue d'ensemble (tableau de bord du Directeur) : quelques agrégats SQL, quel que soit le volume (plusieurs années comprises).
 * Période = ?du=AAAA-MM-JJ&au=AAAA-MM-JJ (dates choisies dans l'interface) ; sans période : l'ANNÉE CIVILE EN COURS.
 * Le graphique montre les mois de la période (au plus les 12 derniers) ; le journal des imports reste celui des derniers fichiers.
 */
final class SyntheseController
{
    /** GET /api/synthese[?du=&au=] → totaux de la période, volume par mois, activité des imports sur la période. */
    public function show(Request $request): Response
    {
        Import::marquerInterrompus('souscriptions', 15);   // un import « en cours » depuis 15 min a été tué par l'hébergeur
        $du = Valider::date($request, 'du');
        $au = Valider::date($request, 'au');
        $annee = (int) date('Y');
        $debut = $du ?? $annee.'-01-01';
        $fin = $au ?? ($du ? '9999-12-31' : $annee.'-12-31');
        if ($debut > $fin) {
            [$debut, $fin] = [$fin, $debut];
        }

        $parMois = array_map(static fn (array $m) => ['mois' => $m['mois'], 'lignes' => (int) $m['lignes'], 'ok' => (int) $m['ok'], 'ca_ok' => (float) $m['ca_ok']], Db::select(
            "SELECT `mois`, COUNT(*) AS lignes, SUM(CASE WHEN `statut` = 'OK' THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN `statut` = 'OK' THEN `montant_total` ELSE 0 END) AS ca_ok FROM `celtiis_datas` WHERE `jour` BETWEEN ? AND ? GROUP BY `mois` ORDER BY `mois`",
            [$debut, $fin]
        ));

        $distincts = Db::first('SELECT COUNT(DISTINCT `login_key`) AS vendeurs, COUNT(DISTINCT `agence`) AS agences, COUNT(DISTINCT `nom_offre`) AS offres, MIN(`jour`) AS du, MAX(`jour`) AS au FROM `celtiis_datas` WHERE `jour` BETWEEN ? AND ?', [$debut, $fin]) ?? [];

        // Imports de la période : fichiers dont les données recoupent la période (stats du / au), sinon faits pendant la période (échecs, objectifs)
        $imports = [];
        foreach (Db::select('SELECT `statut`, `stats`, `created_at` FROM `imports`') as $i) {
            $st = json_decode((string) ($i['stats'] ?? ''), true) ?: [];
            $dansPeriode = ! empty($st['du']) && ! empty($st['au'])
                ? $st['du'] <= $fin && $st['au'] >= $debut
                : substr((string) $i['created_at'], 0, 10) >= $debut && substr((string) $i['created_at'], 0, 10) <= $fin;
            if ($dansPeriode) {
                $imports[$i['statut']] = ($imports[$i['statut']] ?? 0) + 1;
            }
        }

        $derniers = array_map(static fn (array $i) => [
            'type' => $i['type'],
            'nom' => $i['nom_fichier'],
            'statut' => $i['statut'],
            'date' => SouscriptionController::iso8601($i['created_at']),
            'nouvelles' => $i['stats']['nouvelles'] ?? null,
            'modifiees' => $i['stats']['modifiees'] ?? null,
            'feuilles' => isset($i['stats']['feuilles']) ? count(array_filter($i['stats']['feuilles'], static fn (array $f) => $f['statut'] === 'importee')) : null,
            'erreur' => $i['erreur'] ? mb_substr($i['erreur'], 0, 160) : null,
        ], Import::derniers(30));   // la liste défile au-delà de 6 lignes (dashboard.css)

        return Response::json([
            'annee' => $annee,
            'periode' => $du || $au ? ['du' => $debut, 'au' => $fin] : null,   // null : année en cours
            'totaux' => [
                'lignes' => array_sum(array_column($parMois, 'lignes')),
                'ok' => array_sum(array_column($parMois, 'ok')),
                'ca_ok' => array_sum(array_column($parMois, 'ca_ok')),
                'mois' => count($parMois),
                'vendeurs' => (int) ($distincts['vendeurs'] ?? 0),
                'agences' => (int) ($distincts['agences'] ?? 0),
                'offres' => (int) ($distincts['offres'] ?? 0),
                'du' => $distincts['du'] ?? null,
                'au' => $distincts['au'] ?? null,
            ],
            'par_mois' => $parMois,
            'imports' => [
                'total' => (int) array_sum($imports),
                'ok' => (int) ($imports['ok'] ?? 0),
                'echec' => (int) ($imports['echec'] ?? 0),
                'derniers' => $derniers,
            ],
        ]);
    }
}
