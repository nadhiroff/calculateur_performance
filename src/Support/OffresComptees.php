<?php

namespace App\Support;

/**
 * Offres (NOM_OFFRE) comptées dans les calculs — même règle que regles.js (offresComptees / filtreOffres) :
 * liste « offres_comptees » des règles du mois, sinon celle de calculateur/config/regles_defaut.json ; liste vide = toutes
 * les offres. Comparaison sans casse, sans accents, espaces multiples réduits. Les autres offres restent en base, ignorées.
 */
final class OffresComptees
{
    /** @var string[]|null */
    private static ?array $defaut = null;

    /**
     * @param  array<string, mixed>  $regles  règles du mois
     * @return string[]
     */
    public static function liste(array $regles): array
    {
        $l = is_array($regles['offres_comptees'] ?? null) ? $regles['offres_comptees'] : self::defaut();

        return array_values(array_filter(array_map(static fn ($o) => trim((string) $o), $l), static fn (string $o) => $o !== ''));
    }

    /**
     * @param  array<string, mixed>  $regles
     * @return \Closure(?string): bool
     */
    public static function filtre(array $regles): \Closure
    {
        $cles = array_flip(array_map([self::class, 'cle'], self::liste($regles)));

        return static fn (?string $offre): bool => ! $cles || isset($cles[self::cle((string) $offre)]);
    }

    /** Clé de comparaison : comme CT.regles.cleOffre (NFD, diacritiques retirés, minuscules, espaces réduits). */
    public static function cle(string $offre): string
    {
        if (class_exists(\Normalizer::class)) {
            $offre = (string) preg_replace('/[\x{0300}-\x{036f}]/u', '', (string) \Normalizer::normalize($offre, \Normalizer::FORM_D));
        } else {
            $offre = strtr($offre, ['à' => 'a', 'â' => 'a', 'ä' => 'a', 'á' => 'a', 'ã' => 'a', 'ç' => 'c', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
                'î' => 'i', 'ï' => 'i', 'í' => 'i', 'ô' => 'o', 'ö' => 'o', 'ó' => 'o', 'õ' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ú' => 'u', 'ÿ' => 'y', 'ñ' => 'n',
                'À' => 'A', 'Â' => 'A', 'Ä' => 'A', 'Á' => 'A', 'Ã' => 'A', 'Ç' => 'C', 'É' => 'E', 'È' => 'E', 'Ê' => 'E', 'Ë' => 'E',
                'Î' => 'I', 'Ï' => 'I', 'Í' => 'I', 'Ô' => 'O', 'Ö' => 'O', 'Ó' => 'O', 'Õ' => 'O', 'Ù' => 'U', 'Û' => 'U', 'Ü' => 'U', 'Ú' => 'U', 'Ÿ' => 'Y', 'Ñ' => 'N']);
        }

        return trim((string) preg_replace('/\s+/u', ' ', mb_strtolower($offre)));
    }

    /** @return string[] */
    private static function defaut(): array
    {
        if (self::$defaut === null) {
            $f = dirname(__DIR__, 2).'/calculateur/config/regles_defaut.json';
            $j = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
            self::$defaut = is_array($j['offres_comptees'] ?? null) ? $j['offres_comptees'] : [];
        }

        return self::$defaut;
    }
}
