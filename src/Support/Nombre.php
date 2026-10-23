<?php

namespace App\Support;

/**
 * Arrondi EXACT, identique au round() de PHP 8.4+ et au Math.round() du calculateur (pour les nombres positifs).
 *
 * Pourquoi : jusqu'à PHP 8.3, round() « pré-arrondit » la valeur avant de l'arrondir. Exemple réel, fichier d'objectifs
 * d'octobre (équipe TANGO, colonne JOUR = 52,5 / 5) : 10.499999999999998 donne 11 en PHP 8.1 au lieu de 10.
 * Ici la décision se prend sur l'écriture décimale la plus courte du nombre (règle de PHP 8.4+) : le résultat ne dépend
 * plus de la version de PHP.
 */
final class Nombre
{
    /** Arrondi au plus proche, demi vers l'extérieur (2.5 → 3, -2.5 → -3), à $decimales chiffres après la virgule. */
    public static function arrondi(float $v, int $decimales = 0): float
    {
        if (! is_finite($v) || abs($v) >= 1e14) {
            return $v;
        }

        [$entier, $fraction] = explode('.', self::ecritureCourte(abs($v)));
        $fraction = str_pad($fraction, $decimales + 1, '0');
        $garde = substr($fraction, 0, $decimales);
        $n = (int) ($entier.$garde);
        if ($fraction[$decimales] >= '5') {
            $n++;
        }
        $resultat = $decimales > 0 ? $n / 10 ** $decimales : (float) $n;

        return $v < 0 ? -$resultat : $resultat;
    }

    /**
     * Écriture décimale la plus courte qui redonne exactement le même nombre (« 1.005 », « 10.499999999999998 ») :
     * c'est sur elle que PHP 8.4+ décide de l'arrondi, et c'est ce que l'utilisateur voit dans Excel.
     */
    private static function ecritureCourte(float $v): string
    {
        $precedente = ini_get('serialize_precision');
        ini_set('serialize_precision', '-1');
        $s = var_export($v, true);
        ini_set('serialize_precision', (string) $precedente);

        if (stripos($s, 'E') !== false) {
            $s = rtrim(sprintf('%.40F', $v), '0');   // très petits nombres : écriture développée
        }

        return str_contains($s, '.') ? $s : $s.'.0';
    }
}
