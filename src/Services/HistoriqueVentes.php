<?php

namespace App\Services;

use App\Db;
use App\Support\Cache;

/**
 * Historique mensuel des ventes par partenaire (Paramètres › Partenaires, Performance partenaire), complété
 * automatiquement à partir des ventes en base.
 *
 * Pour chaque mois de l'année de l'historique qui contient des ventes en base, les valeurs sont CALCULÉES (mêmes règles
 * que la page Performance : partenaire déduit du login puis de l'agence comme parser.js, ventes aux statuts comptés du mois).
 * Les mois sans aucune donnée en base (avant la mise en service, par exemple) gardent les valeurs saisies à la main.
 * Le résultat indique, mois par mois, la source (« auto ») : ces mois ne sont pas modifiables dans les Paramètres.
 */
final class HistoriqueVentes
{
    /**
     * @param  array<string, mixed>|object  $cfgPartenaires  configuration partenaires (alias_login, regles_agence, defaut, historique)
     * @return array<string, mixed>  historique complété : annee, mois, partenaires, auto (12 booléens)
     */
    public static function completer(array|object $cfgPartenaires): array
    {
        $cfg = json_decode((string) json_encode($cfgPartenaires), true) ?: [];
        $h = $cfg['historique'] ?? [];
        $annee = (int) ($h['annee'] ?? date('Y'));
        $mois = $h['mois'] ?? ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
        $partenaires = $h['partenaires'] ?? [];

        // Calcul en base, gardé en cache : renouvelé à chaque import et à chaque modification des paramètres (alias, agences…)
        $reel = Cache::memoriser('historique:'.$annee.':'.md5((string) json_encode([$cfg['alias_login'] ?? [], $cfg['regles_agence'] ?? [], $cfg['defaut'] ?? null])).':'.Cache::version(), 600,
            static fn () => self::ventesEnBase($annee, $cfg));

        $auto = array_fill(0, 12, false);
        foreach ($reel as $m => $parPartenaire) {
            $i = (int) $m - 1;
            $auto[$i] = true;
            foreach (array_keys($partenaires) as $p) {
                $partenaires[$p][$i] = 0;   // partenaire sans vente ce mois-là
            }
            foreach ($parPartenaire as $p => $n) {
                $partenaires[$p] ??= array_fill(0, 12, 0);
                $partenaires[$p][$i] = $n;
            }
        }
        foreach ($partenaires as &$v) {
            $v = array_map('intval', array_replace(array_fill(0, 12, 0), array_values($v)));
        }
        unset($v);
        ksort($partenaires);

        return ['annee' => $annee, 'mois' => $mois, 'partenaires' => $partenaires, 'auto' => $auto];
    }

    /**
     * Ventes comptées par mois (1-12) et par partenaire pour une année, à partir de celtiis_datas.
     *
     * @param  array<string, mixed>  $cfg
     * @return array<int, array<string, int>>  mois → partenaire → ventes (seulement les mois présents en base)
     */
    private static function ventesEnBase(int $annee, array $cfg): array
    {
        $partenaireDe = self::classifieur($cfg);
        $statuts = [];
        $out = [];
        // Regroupé en SQL par login / agence / statut : quelques milliers de lignes au plus, quelle que soit la taille de la base
        foreach (Db::select(
            'SELECT `mois`, `login_vendeur`, `agence`, `statut`, COUNT(*) AS n FROM `celtiis_datas` WHERE `mois` LIKE ? GROUP BY `mois`, `login_vendeur`, `agence`, `statut`',
            [$annee.'-%']
        ) as $r) {
            $m = (int) substr($r['mois'], 5, 2);
            $out[$m] ??= [];
            $statuts[$r['mois']] ??= array_map('strval', AgentTableau::parametres($r['mois'])['regles']['statuts_comptes'] ?? ['OK']);
            if (! in_array((string) $r['statut'], $statuts[$r['mois']], true)) {
                continue;
            }
            $p = $partenaireDe((string) $r['login_vendeur'], (string) $r['agence']);
            $out[$m][$p] = ($out[$m][$p] ?? 0) + (int) $r['n'];
        }
        ksort($out);

        return $out;
    }

    /**
     * Partenaire d'une vente — même règle que parser.js (classer) : jeton du login « pvt_<jeton>_… » (alias, sinon jeton
     * en majuscules), puis motifs sur l'agence (expressions régulières insensibles à la casse, dans l'ordre), sinon défaut.
     *
     * @param  array<string, mixed>  $cfg
     * @return \Closure(string, string): string
     */
    public static function classifieur(array $cfg): \Closure
    {
        $alias = array_change_key_case($cfg['alias_login'] ?? [], CASE_LOWER);
        $regles = [];
        foreach ($cfg['regles_agence'] ?? [] as $r) {
            $re = '~'.str_replace('~', '\~', (string) ($r['motif'] ?? '')).'~iu';
            if (@preg_match($re, '') !== false) {   // motif invalide : ignoré (le navigateur le refuse aussi à la saisie)
                $regles[] = [$re, (string) ($r['partenaire'] ?? '')];
            }
        }
        $defaut = (string) ($cfg['defaut'] ?? 'AUTRES');

        return static function (string $login, string $agence) use ($alias, $regles, $defaut): string {
            if (preg_match('/^(?:pvt|pms|stg)[_-]([a-z0-9]+)[_-]/', mb_strtolower(trim($login)), $m)) {
                return (string) ($alias[$m[1]] ?? mb_strtoupper($m[1]));
            }
            foreach ($regles as [$re, $p]) {
                if (preg_match($re, trim($agence))) {
                    return $p;
                }
            }

            return $defaut;
        };
    }
}
