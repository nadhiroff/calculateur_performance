<?php

namespace App\Models;

use App\Db;
use stdClass;

/**
 * Règles de calcul (table calcul_rules). Valeurs manipulées en OBJETS (json_decode sans assoc) pour ne pas perdre la
 * distinction JS {} / [] : un objet vide {} décodé en tableau PHP deviendrait [] et la clé ajoutée plus tard côté
 * navigateur serait perdue à la sérialisation.
 */
final class CalcRule
{
    public const GLOBAL = 'global';
    public const PREFIXE_PARTENAIRES = 'partenaires.';

    /* ---------- Lecture ---------- */

    /** Règles d'un mois sous la forme exacte de l'ancien regles_defaut.json (« periode » incluse), ou null si aucune. */
    public static function pourMois(string $mois): ?stdClass
    {
        $lignes = Db::select('SELECT `cle`, `valeur` FROM `calcul_rules` WHERE `mois` = ? ORDER BY `position`', [$mois]);
        if (! $lignes) {
            return null;
        }
        $o = new stdClass();
        $o->periode = $mois;
        foreach ($lignes as $l) {
            $o->{$l['cle']} = json_decode($l['valeur']);
        }

        return $o;
    }

    /** Configuration partenaires (alias_login, regles_agence, historique…), ou null si aucune. */
    public static function partenaires(): ?stdClass
    {
        $lignes = Db::select('SELECT `cle`, `valeur` FROM `calcul_rules` WHERE `mois` = ? AND `cle` LIKE ? ORDER BY `position`', [self::GLOBAL, self::PREFIXE_PARTENAIRES.'%']);
        if (! $lignes) {
            return null;
        }
        $o = new stdClass();
        foreach ($lignes as $l) {
            $o->{substr($l['cle'], strlen(self::PREFIXE_PARTENAIRES))} = json_decode($l['valeur']);
        }

        return $o;
    }

    /** @return string[] mois pour lesquels des règles existent */
    public static function moisDisponibles(): array
    {
        return array_column(Db::select('SELECT DISTINCT `mois` FROM `calcul_rules` WHERE `mois` != ? ORDER BY `mois`', [self::GLOBAL]), 'mois');
    }

    /* ---------- Écriture (UPSERT sur la clé unique mois + cle) ---------- */

    /** @param stdClass $regles objet décodé par json_decode($json) (sans assoc) */
    public static function ecrireMois(string $mois, stdClass $regles): void
    {
        $valeurs = get_object_vars($regles);
        unset($valeurs['periode']);
        self::ecrire($mois, $valeurs, '');
    }

    /** @param stdClass $partenaires objet décodé par json_decode($json) (sans assoc) */
    public static function ecrirePartenaires(stdClass $partenaires): void
    {
        self::ecrire(self::GLOBAL, get_object_vars($partenaires), self::PREFIXE_PARTENAIRES);
    }

    /**
     * Supprime les règles des mois qui ne figurent plus dans la liste (mois retirés dans Paramètres).
     *
     * @param  string[]  $moisGardes
     */
    public static function purgerMoisAbsents(array $moisGardes): void
    {
        $moisGardes = $moisGardes ?: [''];
        Db::executer('DELETE FROM `calcul_rules` WHERE `mois` != ? AND `mois` NOT IN ('.Db::marques(count($moisGardes)).')', [self::GLOBAL, ...$moisGardes]);
    }

    /** @param array<string, mixed> $valeurs */
    private static function ecrire(string $mois, array $valeurs, string $prefixe): void
    {
        $now = Db::maintenant();
        $rows = [];
        $pos = 0;
        foreach ($valeurs as $cle => $valeur) {
            $rows[] = ['mois' => $mois, 'cle' => $prefixe.$cle, 'valeur' => json_encode($valeur, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION), 'position' => $pos++, 'created_at' => $now, 'updated_at' => $now];
        }
        if (! $rows) {
            return;
        }

        Db::transaction(function () use ($mois, $prefixe, $rows) {
            Db::upsert('calcul_rules', $rows, ['valeur', 'position', 'updated_at']);

            // Groupes de règles retirés : supprimés pour que la base reflète exactement l'état envoyé
            $gardees = array_column($rows, 'cle');
            $sql = 'DELETE FROM `calcul_rules` WHERE `mois` = ? AND `cle` NOT IN ('.Db::marques(count($gardees)).')';
            $params = [$mois, ...$gardees];
            if ($prefixe !== '') {
                $sql .= ' AND `cle` LIKE ?';
                $params[] = $prefixe.'%';
            }
            Db::executer($sql, $params);
        });
    }
}
