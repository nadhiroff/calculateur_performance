<?php

namespace App\Services;

use App\Support\Nombre;

/**
 * Compare les objectifs importés (lignes plates) à ceux déjà en base pour le mois.
 * Seuls les champs que l'import peut écraser sont comparés : superviseur et segment (saisis à la main) sont ignorés,
 * sinon chaque ré-import signalerait à tort une « modification ».
 */
final class ObjectifsDiff
{
    private const CHAMPS = [
        'equipe' => ['obj_jour', 'obj_semaine', 'part_rgz'],
        'login'  => ['equipe', 'obj_b2c', 'obj_b2b', 'obj_jour', 'obj_semaine', 'primes'],
    ];

    private const LIBELLES = [
        'equipe' => 'équipe', 'obj_b2c' => 'B2C', 'obj_b2b' => 'B2B', 'obj_jour' => 'jour',
        'obj_semaine' => 'semaine', 'part_rgz' => 'part RGZ', 'primes' => 'primes',
    ];

    /**
     * @param  iterable<array<string, mixed>>  $existantes  lignes de MensualObjective::duMois()
     * @param  array<int, array<string, mixed>>  $entrantes
     * @return array<string, mixed>
     */
    public static function comparer(iterable $existantes, array $entrantes): array
    {
        $base = [];
        foreach ($existantes as $r) {
            $base[$r['niveau'] . '|' . $r['cle']] = $r;
        }
        $nouv = [];
        foreach ($entrantes as $l) {
            $nouv[$l['niveau'] . '|' . $l['cle']] = $l;
        }

        $ajoutes = $supprimes = $modifies = [];
        $inchanges = 0;

        foreach ($nouv as $k => $l) {
            if (!isset($base[$k])) {
                $ajoutes[] = ['niveau' => $l['niveau'], 'cle' => $l['cle'], 'libelle' => self::libelle($l)];
                continue;
            }
            $champs = [];
            foreach (self::CHAMPS[$l['niveau']] as $c) {
                $avant = self::norm($base[$k][$c]);
                $apres = self::norm($l[$c] ?? null);
                if ($avant !== $apres) {
                    $champs[self::LIBELLES[$c] ?? $c] = ['avant' => $avant, 'apres' => $apres];
                }
            }
            if ($champs) {
                $modifies[] = ['niveau' => $l['niveau'], 'cle' => $l['cle'], 'libelle' => self::libelle($l), 'champs' => $champs];
            } else {
                $inchanges++;
            }
        }
        foreach ($base as $k => $r) {
            if (!isset($nouv[$k])) {
                $supprimes[] = ['niveau' => $r['niveau'], 'cle' => $r['cle'], 'libelle' => self::libelle($r)];
            }
        }

        return [
            'identique' => !$ajoutes && !$supprimes && !$modifies,
            'resume'    => ['ajoutes' => count($ajoutes), 'modifies' => count($modifies), 'supprimes' => count($supprimes), 'inchanges' => $inchanges],
            'ajoutes'   => $ajoutes,
            'modifies'  => $modifies,
            'supprimes' => $supprimes,
        ];
    }

    private static function libelle(array $l): string
    {
        return $l['niveau'] === 'equipe' ? 'Équipe ' . $l['equipe'] : (string) ($l['login'] ?: $l['cle']);
    }

    private static function norm(mixed $v): mixed
    {
        if ($v === null) {
            return null;
        }
        if (is_bool($v)) {
            return (int) $v;
        }
        if (is_numeric($v)) {
            return Nombre::arrondi((float) $v, 4);
        }

        return trim((string) $v);
    }
}
