<?php

namespace App\Controllers;

use App\Db;
use App\Http\Request;
use App\Http\Response;
use App\Http\Valider;
use App\Models\Import;
use App\Services\AgentTableau;
use App\Support\OffresComptees;

/**
 * Vue d'ensemble (tableau de bord du Directeur) : quelques agrégats SQL, quel que soit le volume (plusieurs années comprises).
 * Seules les offres comptées du mois (regles.offres_comptees) entrent dans les totaux ; « validées » = statuts comptés du mois.
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

        // Offres et statuts comptés de chaque mois (mêmes règles que les calculs) : les autres offres sont ignorées
        $regles = [];
        $regle = static function (string $mois) use (&$regles): array {
            if (! isset($regles[$mois])) {
                $R = AgentTableau::parametres($mois)['regles'];
                $regles[$mois] = [array_map('strval', $R['statuts_comptes'] ?? ['OK']), OffresComptees::filtre($R)];
            }

            return $regles[$mois];
        };
        $parMois = [];
        foreach (Db::select(
            'SELECT `mois`, `statut`, `nom_offre`, COUNT(*) AS lignes, SUM(`montant_total`) AS ca FROM `celtiis_datas` WHERE `jour` BETWEEN ? AND ? GROUP BY `mois`, `statut`, `nom_offre` ORDER BY `mois`',
            [$debut, $fin]
        ) as $r) {
            [$statuts, $offreOk] = $regle((string) $r['mois']);
            if (! $offreOk($r['nom_offre'])) {
                continue;
            }
            $m = &$parMois[$r['mois']];
            $m ??= ['mois' => $r['mois'], 'lignes' => 0, 'ok' => 0, 'ca_ok' => 0.0];
            $m['lignes'] += (int) $r['lignes'];
            if (in_array((string) $r['statut'], $statuts, true)) {
                $m['ok'] += (int) $r['lignes'];
                $m['ca_ok'] += (float) $r['ca'];
            }
            unset($m);
        }
        $parMois = array_values($parMois);

        $vendeurs = $agences = $offres = [];
        $du0 = $au0 = null;
        foreach (Db::select('SELECT `mois`, `nom_offre`, `login_key`, `agence`, MIN(`jour`) AS du, MAX(`jour`) AS au FROM `celtiis_datas` WHERE `jour` BETWEEN ? AND ? GROUP BY `mois`, `nom_offre`, `login_key`, `agence`', [$debut, $fin]) as $r) {
            if (! $regle((string) $r['mois'])[1]($r['nom_offre'])) {
                continue;
            }
            $vendeurs[(string) $r['login_key']] = 1;
            $agences[(string) $r['agence']] = 1;
            $offres[OffresComptees::cle((string) $r['nom_offre'])] = 1;
            $du0 = $du0 === null || $r['du'] < $du0 ? $r['du'] : $du0;
            $au0 = $au0 === null || $r['au'] > $au0 ? $r['au'] : $au0;
        }
        $distincts = ['vendeurs' => count($vendeurs), 'agences' => count($agences), 'offres' => count($offres), 'du' => $du0, 'au' => $au0];

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
