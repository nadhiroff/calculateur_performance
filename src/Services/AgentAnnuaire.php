<?php

namespace App\Services;

use App\Db;
use App\Support\LoginKey;

/**
 * Identification d'un commercial RGZ par son login : seuls les logins présents dans les objectifs (table mensual_objectives)
 * sont reconnus. Saisie tolérante (majuscules, « - » au lieu de « _ », « .ftth » facultatif, espaces) ; en cas de faute
 * de frappe, quelques logins proches sont proposés.
 */
final class AgentAnnuaire
{
    private const SUGGESTIONS = 3;

    /**
     * @return array{exact: array{cle: string, login: string, equipe: string, mois: string}|null, proches: array<int, array{cle: string, login: string, equipe: string}>}
     */
    public static function chercher(string $saisie): array
    {
        $cle = LoginKey::from((string) preg_replace('/\s+/', '', $saisie));
        $tous = self::logins();
        if ($cle === '') {
            return ['exact' => null, 'proches' => []];
        }
        if (isset($tous[$cle])) {
            return ['exact' => $tous[$cle], 'proches' => []];
        }

        // Faute de frappe : distance d'édition sur le login complet ET sur la partie après « pvt_rgz_ » (souvent seule retenue)
        $candidats = [];
        foreach ($tous as $k => $l) {
            $court = self::court($k);
            $distance = min(levenshtein($cle, $k), levenshtein(self::court($cle), $court));
            $tolere = max(2, intdiv(strlen($court), 4));
            $contient = strlen($cle) >= 4 && (str_contains($k, $cle) || str_contains($cle, $court));
            if ($distance <= $tolere || $contient) {
                $candidats[] = ['distance' => $contient ? min($distance, 1) : $distance, 'l' => $l];
            }
        }
        usort($candidats, static fn (array $x, array $y) => $x['distance'] <=> $y['distance'] ?: strcmp($x['l']['cle'], $y['l']['cle']));

        return ['exact' => null, 'proches' => array_map(
            static fn (array $c) => array_intersect_key($c['l'], ['cle' => 1, 'login' => 1, 'equipe' => 1]),
            array_slice($candidats, 0, self::SUGGESTIONS)
        )];
    }

    /** « pvt_rgz_tgloria » → « tgloria » */
    private static function court(string $cle): string
    {
        return (string) preg_replace('/^(pvt|pms|stg)_[a-z0-9]+_/', '', $cle);
    }

    /**
     * Logins RGZ connus : clé → login, équipe et mois les plus récents.
     *
     * @return array<string, array{cle: string, login: string, equipe: string, mois: string}>
     */
    private static function logins(): array
    {
        $out = [];
        foreach (Db::select("SELECT `cle`, `login`, `equipe`, `mois` FROM `mensual_objectives` WHERE `niveau` = 'login' ORDER BY `mois` DESC") as $r) {
            $out[$r['cle']] ??= ['cle' => $r['cle'], 'login' => (string) $r['login'], 'equipe' => (string) $r['equipe'], 'mois' => $r['mois']];
        }

        return $out;
    }
}
