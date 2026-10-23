<?php

namespace App\Models;

use App\Db;

/** Objectifs mensuels (table mensual_objectives) : une ligne par équipe et par login. Lignes renvoyées en tableaux typés. */
final class MensualObjective
{
    /** Colonnes écrasées par un IMPORT FICHIER. superviseur et segment n'y figurent volontairement pas : ils sont saisis à la main. */
    public const COLONNES_IMPORT = ['equipe', 'login', 'position', 'obj_b2c', 'obj_b2b', 'obj_jour', 'obj_semaine', 'part_rgz', 'primes', 'extra', 'updated_at'];

    /** Colonnes écrasées par la sauvegarde COMPLÈTE des paramètres (l'écran Paramètres fait foi, superviseur inclus). */
    public const COLONNES_PARAMETRES = [...self::COLONNES_IMPORT, 'superviseur', 'segment'];

    /** @return array<int, array<string, mixed>> lignes d'un mois, triées par position */
    public static function duMois(string $mois): array
    {
        return self::lister(['mois' => $mois]);
    }

    /**
     * Filtres : mois, niveau, equipe. Tri : mois puis position.
     *
     * @param  array<string, mixed>  $f
     * @return array<int, array<string, mixed>>
     */
    public static function lister(array $f = []): array
    {
        $where = [];
        $params = [];
        foreach (['mois', 'niveau', 'equipe'] as $c) {
            if (! empty($f[$c])) {
                $where[] = "`$c` = ?";
                $params[] = $f[$c];
            }
        }
        $sql = 'SELECT * FROM `mensual_objectives`'.($where ? ' WHERE '.implode(' AND ', $where) : '').' ORDER BY `mois`, `position`';

        return array_map([self::class, 'typer'], Db::select($sql, $params));
    }

    /**
     * Écrit un lot de lignes d'un mois avec UPSERT sur la clé unique (mois, niveau, cle) : insère les nouvelles, met à jour les existantes.
     * $avecManuel = true  → met aussi à jour superviseur / segment.
     * $supprimerAbsentes  → supprime du mois les lignes qui ne figurent plus dans le lot.
     * À appeler DANS une transaction.
     *
     * @param  array<int, array<string, mixed>>  $lignes  (sorties de ObjectifsMapper::depuisEquipes)
     */
    public static function appliquer(string $mois, array $lignes, bool $avecManuel, bool $supprimerAbsentes = true): void
    {
        $now = Db::maintenant();
        $rows = array_map(static function (array $l) use ($mois, $now) {
            $l['mois'] = $mois;
            $l['extra'] = $l['extra'] ? json_encode($l['extra'], JSON_UNESCAPED_UNICODE) : null;
            $l['created_at'] = $now;
            $l['updated_at'] = $now;

            return $l;
        }, $lignes);

        foreach (array_chunk($rows, 200) as $lot) {
            Db::upsert('mensual_objectives', $lot, $avecManuel ? self::COLONNES_PARAMETRES : self::COLONNES_IMPORT);
        }

        if ($supprimerAbsentes) {
            $gardees = [];
            foreach ($lignes as $l) {
                $gardees[$l['niveau']][] = $l['cle'];
            }
            $conditions = [];
            $params = [$mois];
            foreach (['equipe', 'login'] as $niveau) {
                if (! empty($gardees[$niveau])) {
                    $conditions[] = '(`niveau` = ? AND `cle` NOT IN ('.Db::marques(count($gardees[$niveau])).'))';
                    array_push($params, $niveau, ...$gardees[$niveau]);
                } else {
                    $conditions[] = '(`niveau` = ?)';
                    $params[] = $niveau;
                }
            }
            Db::executer('DELETE FROM `mensual_objectives` WHERE `mois` = ? AND ('.implode(' OR ', $conditions).')', $params);
        }
    }

    /**
     * Conversions de types (comme les « casts » de l'ancienne version) : primes booléen, extra décodé, décimaux en float.
     *
     * @param  array<string, mixed>  $r
     * @return array<string, mixed>
     */
    public static function typer(array $r): array
    {
        $r['primes'] = (bool) $r['primes'];
        $r['extra'] = $r['extra'] === null ? null : json_decode((string) $r['extra'], true);
        foreach (['obj_jour', 'obj_semaine', 'part_rgz'] as $c) {
            $r[$c] = $r[$c] === null ? null : (float) $r[$c];
        }
        foreach (['created_at', 'updated_at'] as $c) {
            $r[$c] = $r[$c] === null ? null : date('Y-m-d\TH:i:s.000000\Z', (int) strtotime($r[$c].' UTC'));
        }

        return $r;
    }
}
