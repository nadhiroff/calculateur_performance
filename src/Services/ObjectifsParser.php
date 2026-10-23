<?php

namespace App\Services;

use App\Support\Nombre;

use App\Support\ExcelReader;
use App\Support\Texte;

/**
 * Tableau Excel → équipes/logins. Les valeurs doivent être des NOMBRES : ExcelReader::aoa() fournit la valeur en cache
 * des formules (voir son commentaire — c'était la cause de « Aucun objectif reconnu »). PORT FIDÈLE de CT.objectifs.depuisExcel (objectifs.js) pour que l'import serveur
 * donne exactement le même résultat que l'ancien import navigateur. Deux formats reconnus :
 *   1) modèle exporté par l'application (colonnes Équipe / Login / Obj. B2C / Obj. B2B / …) ;
 *   2) fichier « OBJECTIFS TRACKING » de Celtiis.
 * Vérifié sur objectifs_octobre_2026.xlsx avec le parseur JS d'origine : 10 équipes, 43 logins, 1 247 B2C + 240 B2B = 1 487.
 */
final class ObjectifsParser
{
    private static function norm(mixed $s): string
    {
        return Texte::ascii(mb_strtolower(trim((string) ($s ?? ''))));
    }

    /** Nombre réel, ou texte numérique (« 17 », « 1,75 ») : tolère les exports CSV où tout est du texte. */
    private static function estNombre(mixed $v): bool
    {
        if (is_int($v) || is_float($v)) {
            return true;
        }

        return is_string($v) && $v !== '' && is_numeric(str_replace([' ', "\u{00A0}", ','], ['', '', '.'], $v));
    }

    private static function arrondi(mixed $v): int
    {
        return (int) Nombre::arrondi(ExcelReader::nombre($v));
    }

    /** @param array<int, array<int, mixed>> $aoa  @return array<int, array<string, mixed>> */
    public static function parse(array $aoa): array
    {
        $equipes = [];

        // ---- Format 1 : modèle exporté ----
        $hi = -1;
        foreach ($aoa as $i => $r) {
            if (!is_array($r)) {
                continue;
            }
            $n = array_map([self::class, 'norm'], $r);
            $aLogin = in_array('login', $n, true);
            $aB2c = (bool) array_filter($n, fn ($c) => preg_match('/^obj.*b2c/', $c));
            if ($aLogin && $aB2c) {
                $hi = $i;
                break;
            }
        }

        if ($hi >= 0) {
            $head = array_map([self::class, 'norm'], $aoa[$hi]);
            $ci = static function (string $re) use ($head): int {
                foreach ($head as $k => $c) {
                    if (preg_match($re, $c)) {
                        return $k;
                    }
                }

                return -1;
            };
            [$cE, $cL, $cC, $cB, $cP, $cR, $cJ, $cS] = [$ci('/^equipe/'), $ci('/^login/'), $ci('/b2c/'), $ci('/b2b/'), $ci('/prime/'), $ci('/part/'), $ci('/^obj.*jour/'), $ci('/^obj.*semaine/')];
            $g = static fn (array $r, int $k) => $k >= 0 ? ($r[$k] ?? null) : null;
            $index = [];

            foreach (array_slice($aoa, $hi + 1) as $r) {
                if (!is_array($r) || empty($g($r, $cL))) {
                    continue;
                }
                $id = trim((string) (!empty($g($r, $cE)) ? $g($r, $cE) : '—'));
                if (!isset($index[$id])) {
                    $partBrut = $g($r, $cR);
                    $equipes[] = [
                        'id' => $id, 'superviseur' => null, 'segment' => null,
                        'part_rgz' => ($cR >= 0 && $partBrut !== null && $partBrut !== '') ? ExcelReader::nombre($partBrut) : 0.2,
                        'logins' => [],
                    ];
                    $index[$id] = count($equipes) - 1;
                }
                $b2c = ExcelReader::nombre($g($r, $cC));
                $b2b = ExcelReader::nombre($g($r, $cB));
                $primes = $cP >= 0
                    ? (!preg_match('/^(non|0|false)$/i', trim((string) ($g($r, $cP) ?? ''))) && $b2c + $b2b > 0)
                    : ($b2c + $b2b > 0);
                $equipes[$index[$id]]['logins'][] = [
                    'login' => trim((string) $g($r, $cL)), 'b2c' => $b2c, 'b2b' => $b2b,
                    'jour' => $cJ >= 0 ? self::arrondi(ExcelReader::nombre($g($r, $cJ))) : 0,
                    'semaine' => $cS >= 0 ? self::arrondi(ExcelReader::nombre($g($r, $cS))) : 0,
                    'primes' => $primes,
                ];
            }

            return $equipes;
        }

        // ---- Format 2 : « OBJECTIFS TRACKING » (colonne B = équipe ou login ; JOUR/SEM/MOIS/B2B/B2C en C..G ; one-shot en L et N) ----
        $courant = null;
        foreach ($aoa as $r) {
            if (!is_array($r)) {
                continue;
            }
            $b = trim((string) ($r[1] ?? ''));
            if ($b === '' || preg_match('/^(objectifs?|grand total)$/i', $b)) {
                continue;
            }
            $estLogin = preg_match('/\.ftth$/i', $b) || preg_match('/^(pvt|pms|stg)[_-]/i', $b);

            if (!$estLogin) {
                if (!self::estNombre($r[4] ?? null) && !self::estNombre($r[2] ?? null)) {
                    continue;
                }
                $L = ExcelReader::nombre($r[11] ?? null);
                $N = ExcelReader::nombre($r[13] ?? null);
                $equipes[] = [
                    'id' => $b, 'superviseur' => null, 'segment' => null,
                    'jour' => self::estNombre($r[2] ?? null) ? self::arrondi($r[2]) : null,
                    'semaine' => self::estNombre($r[3] ?? null) ? self::arrondi($r[3]) : null,
                    'fichier' => [
                        'b2c' => self::estNombre($r[6] ?? null) ? self::arrondi($r[6]) : null,
                        'b2b' => self::estNombre($r[5] ?? null) ? self::arrondi($r[5]) : null,
                        'mois' => self::estNombre($r[4] ?? null) ? self::arrondi($r[4]) : null,
                    ],
                    'part_rgz' => $L > 0 ? Nombre::arrondi($N / $L, 4) : (preg_match('/anonymat/i', $b) ? 0 : 0.2),
                    'logins' => [],
                ];
                $courant = count($equipes) - 1;
                continue;
            }

            if ($courant === null) {
                continue;
            }
            $b2c = ExcelReader::nombre($r[6] ?? null);
            $b2b = ExcelReader::nombre($r[5] ?? null);
            $equipes[$courant]['logins'][] = [
                'login' => $b, 'b2c' => $b2c, 'b2b' => $b2b,
                'jour' => self::estNombre($r[2] ?? null) ? self::arrondi($r[2]) : 0,
                'semaine' => self::estNombre($r[3] ?? null) ? self::arrondi($r[3]) : 0,
                'mois' => self::estNombre($r[4] ?? null) ? self::arrondi($r[4]) : null,
                'primes' => $b2c + $b2b > 0,
            ];
        }

        return $equipes;
    }
}
