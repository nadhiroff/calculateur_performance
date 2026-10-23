<?php

namespace App\Services;

use App\Support\Nombre;

use App\Support\LoginKey;

/**
 * Passage entre la structure JS « equipes[ { id, jour, semaine, part_rgz, logins:[…] } ] » et les lignes plates de mensual_objectives.
 * Les clés inconnues (fichier, mois…) transitent par la colonne JSON « extra » : l'aller-retour JS → MySQL → JS est sans perte.
 */
final class ObjectifsMapper
{
    private const CLES_EQUIPE = ['id', 'superviseur', 'segment', 'part_rgz', 'jour', 'semaine', 'logins'];
    private const CLES_LOGIN = ['login', 'b2c', 'b2b', 'jour', 'semaine', 'primes'];

    /**
     * @param  array<int, array<string, mixed>>  $equipes
     * @return array{lignes: array<int, array<string, mixed>>, avertissements: string[]}
     */
    public static function depuisEquipes(array $equipes): array
    {
        $lignes = [];
        $avert = [];
        $pos = 0;
        $vus = [];
        $equipesVues = [];

        foreach ($equipes as $e) {
            $id = trim((string) ($e['id'] ?? '—'));
            if (isset($equipesVues[$id])) {
                $avert[] = "Équipe « $id » présente deux fois : seule la dernière est conservée.";
            }
            $equipesVues[$id] = true;

            $extraE = array_diff_key($e, array_flip(self::CLES_EQUIPE));
            $lignes['equipe|' . $id] = [
                'niveau' => 'equipe', 'cle' => $id, 'equipe' => $id, 'login' => null,
                'superviseur' => $e['superviseur'] ?? null, 'segment' => $e['segment'] ?? null,
                'position' => $pos++, 'obj_b2c' => 0, 'obj_b2b' => 0,
                'obj_jour' => isset($e['jour']) ? (float) $e['jour'] : null,
                'obj_semaine' => isset($e['semaine']) ? (float) $e['semaine'] : null,
                'part_rgz' => isset($e['part_rgz']) ? (float) $e['part_rgz'] : null,
                'primes' => true, 'extra' => $extraE ?: null,
            ];

            foreach ($e['logins'] ?? [] as $l) {
                $cle = LoginKey::from($l['login'] ?? '');
                if ($cle === '') {
                    continue;
                }
                if (isset($vus[$cle])) {
                    $avert[] = "Login « {$l['login']} » présent deux fois : seule la dernière occurrence est conservée.";
                }
                $vus[$cle] = true;
                $extraL = array_diff_key($l, array_flip(self::CLES_LOGIN));
                $lignes['login|' . $cle] = [
                    'niveau' => 'login', 'cle' => $cle, 'equipe' => $id, 'login' => trim((string) $l['login']),
                    'superviseur' => null, 'segment' => null,
                    'position' => $pos++,
                    'obj_b2c' => max(0, (int) Nombre::arrondi((float) ($l['b2c'] ?? 0))),
                    'obj_b2b' => max(0, (int) Nombre::arrondi((float) ($l['b2b'] ?? 0))),
                    'obj_jour' => isset($l['jour']) ? (float) $l['jour'] : 0.0,
                    'obj_semaine' => isset($l['semaine']) ? (float) $l['semaine'] : 0.0,
                    'part_rgz' => null,
                    'primes' => ($l['primes'] ?? true) !== false,
                    'extra' => $extraL ?: null,
                ];
            }
        }

        return ['lignes' => array_values($lignes), 'avertissements' => $avert];
    }

    /**
     * @param  iterable<array<string, mixed>>  $lignes  lignes de MensualObjective::duMois(), triées par position
     * @return array<int, array<string, mixed>>
     */
    public static function versEquipes(iterable $lignes): array
    {
        $equipes = [];
        $index = [];

        foreach ($lignes as $r) {
            if ($r['niveau'] !== 'equipe') {
                continue;
            }
            $e = [
                'id' => $r['equipe'], 'superviseur' => $r['superviseur'], 'segment' => $r['segment'],
                'part_rgz' => self::n($r['part_rgz']), 'jour' => self::n($r['obj_jour']), 'semaine' => self::n($r['obj_semaine']),
            ] + ($r['extra'] ?? []);
            $e['logins'] = [];
            $equipes[] = $e;
            $index[$r['equipe']] = count($equipes) - 1;
        }
        foreach ($lignes as $r) {
            if ($r['niveau'] !== 'login' || !isset($index[$r['equipe']])) {
                continue;
            }
            $equipes[$index[$r['equipe']]]['logins'][] = [
                'login' => $r['login'], 'b2c' => (int) $r['obj_b2c'], 'b2b' => (int) $r['obj_b2b'],
                'jour' => self::n($r['obj_jour']) ?? 0, 'semaine' => self::n($r['obj_semaine']) ?? 0, 'primes' => (bool) $r['primes'],
            ] + ($r['extra'] ?? []);
        }

        return $equipes;
    }

    /** 17.0 → 17 (JSON propre), null reste null. */
    private static function n(mixed $v): int|float|null
    {
        if ($v === null) {
            return null;
        }
        $f = (float) $v;

        return floor($f) === $f ? (int) $f : $f;
    }
}
