<?php

namespace App\Http;

/** Petites validations d'entrée : chaque échec lève une erreur 422 { message, errors: { champ: [message] } }. */
final class Valider
{
    public const MOIS = '/^\d{4}-(0[1-9]|1[0-2])$/';

    /** Mois « AAAA-MM » facultatif. */
    public static function mois(Request $r, string $champ, bool $obligatoire = false): ?string
    {
        $v = self::texte($r, $champ, $obligatoire);
        if ($v !== null && ! preg_match(self::MOIS, $v)) {
            throw HttpException::validation($champ, "Le champ $champ doit être au format AAAA-MM (ex. 2026-10).");
        }

        return $v;
    }

    /** Date « AAAA-MM-JJ » facultative. */
    public static function date(Request $r, string $champ): ?string
    {
        $v = self::texte($r, $champ);
        if ($v === null) {
            return null;
        }
        $d = \DateTime::createFromFormat('!Y-m-d', $v);
        if ($d === false || $d->format('Y-m-d') !== $v) {
            throw HttpException::validation($champ, "Le champ $champ doit être une date au format AAAA-MM-JJ.");
        }

        return $v;
    }

    /** @param string[] $valeurs */
    public static function parmi(Request $r, string $champ, array $valeurs): ?string
    {
        $v = self::texte($r, $champ);
        if ($v !== null && ! in_array($v, $valeurs, true)) {
            throw HttpException::validation($champ, "Le champ $champ doit valoir : ".implode(', ', $valeurs).'.');
        }

        return $v;
    }

    public static function entier(Request $r, string $champ, int $min, int $max): ?int
    {
        $v = self::texte($r, $champ);
        if ($v === null) {
            return null;
        }
        if (filter_var($v, FILTER_VALIDATE_INT) === false || (int) $v < $min || (int) $v > $max) {
            throw HttpException::validation($champ, "Le champ $champ doit être un entier entre $min et $max.");
        }

        return (int) $v;
    }

    /** Texte (null si absent ou vide). $max = longueur maximale en caractères. */
    public static function texte(Request $r, string $champ, bool $obligatoire = false, ?int $max = null): ?string
    {
        $v = $r->input($champ);
        if ($v === null || $v === '') {
            if ($obligatoire) {
                throw HttpException::validation($champ, "Le champ $champ est obligatoire.");
            }

            return null;
        }
        if (is_int($v) || is_float($v)) {
            $v = (string) $v;
        }
        if (! is_string($v)) {
            throw HttpException::validation($champ, "Le champ $champ doit être un texte.");
        }
        if ($max !== null && mb_strlen($v) > $max) {
            throw HttpException::validation($champ, "Le champ $champ ne doit pas dépasser $max caractères.");
        }

        return $v;
    }
}
