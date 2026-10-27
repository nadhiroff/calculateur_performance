<?php

namespace App\Services;

use App\Db;
use App\Support\Cache;
use App\Support\OffresComptees;

/**
 * Historique mensuel des ventes par partenaire (Paramètres › Partenaires, Performance partenaire), complété
 * automatiquement à partir des ventes en base.
 *
 * Pour chaque mois de l'année de l'historique qui contient des ventes en base, les valeurs sont CALCULÉES (mêmes règles
 * que la page Performance : partenaire comme parser.js (partenaireDe), ventes aux statuts ET aux offres comptés du mois).
 * Les mois sans aucune donnée en base (avant la mise en service, par exemple) gardent les valeurs saisies à la main.
 * Le résultat indique, mois par mois, la source (« auto ») : ces mois ne sont pas modifiables dans les Paramètres.
 */
final class HistoriqueVentes
{
    /** Version du format des règles partenaires : même valeur que VERSION_REGLES (store.js). */
    public const VERSION_REGLES = 2;

    /**
     * @param  array<string, mixed>|object  $cfgPartenaires  configuration partenaires (logins_partenaire, remplacements_login, regles_agence, defaut, historique)
     * @return array<string, mixed>  historique complété : annee, mois, partenaires, auto (12 booléens)
     */
    public static function completer(array|object $cfgPartenaires): array
    {
        $cfg = self::configuration(json_decode((string) json_encode($cfgPartenaires), true) ?: []);
        $h = $cfg['historique'] ?? [];
        $annee = (int) ($h['annee'] ?? date('Y'));
        $mois = $h['mois'] ?? ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
        $partenaires = $h['partenaires'] ?? [];

        // Calcul en base, gardé en cache : renouvelé à chaque import et à chaque modification des paramètres (logins, agences, offres…)
        $reel = Cache::memoriser('historique-v2:'.$annee.':'.md5((string) json_encode([$cfg['logins_partenaire'] ?? [], $cfg['remplacements_login'] ?? [], $cfg['regles_agence'] ?? [], $cfg['defaut'] ?? null])).':'.Cache::version(), 600,
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
        $offres = [];
        $out = [];
        // Regroupé en SQL par login / agence / statut / offre : quelques milliers de lignes au plus, quelle que soit la taille de la base
        foreach (Db::select(
            'SELECT `mois`, `login_vendeur`, `agence`, `statut`, `nom_offre`, COUNT(*) AS n FROM `celtiis_datas` WHERE `mois` LIKE ? GROUP BY `mois`, `login_vendeur`, `agence`, `statut`, `nom_offre`',
            [$annee.'-%']
        ) as $r) {
            $m = (int) substr($r['mois'], 5, 2);
            $out[$m] ??= [];
            if (! isset($statuts[$r['mois']])) {
                $R = AgentTableau::parametres($r['mois'])['regles'];
                $statuts[$r['mois']] = array_map('strval', $R['statuts_comptes'] ?? ['OK']);
                $offres[$r['mois']] = OffresComptees::filtre($R);
            }
            if (! in_array((string) $r['statut'], $statuts[$r['mois']], true) || ! $offres[$r['mois']]($r['nom_offre'])) {
                continue;
            }
            $p = $partenaireDe((string) $r['login_vendeur'], (string) $r['agence']);
            $out[$m][$p] = ($out[$m][$p] ?? 0) + (int) $r['n'];
        }
        ksort($out);

        return $out;
    }

    /**
     * Configuration partenaires au format actuel : une configuration enregistrée dans l'ancien format (jetons « pvt_<jeton>_ »,
     * version_regles < 2) prend les règles par défaut, exactement comme la migration de store.js qui la réenregistre au
     * prochain chargement de l'application.
     *
     * @param  array<string, mixed>  $cfg
     * @return array<string, mixed>
     */
    public static function configuration(array $cfg): array
    {
        if ((int) ($cfg['version_regles'] ?? 0) >= self::VERSION_REGLES) {
            return $cfg;
        }
        $f = dirname(__DIR__, 2).'/calculateur/config/partenaires_defaut.json';
        $d = is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: []) : [];
        $cfg['remplacements_login'] = $d['remplacements_login'] ?? [];
        $cfg['regles_agence'] = $d['regles_agence'] ?? [];
        $cfg['logins_partenaire'] ??= $d['logins_partenaire'] ?? [];
        unset($cfg['alias_login'], $cfg['regles_agence_vues']);

        return $cfg;
    }

    /**
     * Partenaire d'une vente — même règle que parser.js (partenaireDe), cahier des charges :
     *   1. login dans une liste nominative (logins_partenaire, ex. POP&SHOP) ;
     *   2. remplacements_login dans l'ordre : le login contient le motif (casse ignorée) → partenaire, chaque motif testé sur la
     *      valeur déjà remplacée comme le script d'origine ;
     *   3. login non reconnu : motifs sur l'agence (expressions régulières insensibles à la casse, dans l'ordre), sinon défaut.
     *
     * @param  array<string, mixed>  $cfg
     * @return \Closure(string, string): string
     */
    public static function classifieur(array $cfg): \Closure
    {
        $cfg = self::configuration($cfg);
        $nominatif = [];
        foreach ($cfg['logins_partenaire'] ?? [] as $p => $logins) {
            foreach ((array) $logins as $l) {
                $nominatif[self::cleLogin((string) $l)] = (string) $p;
            }
        }
        $remplacements = [];
        foreach ($cfg['remplacements_login'] ?? [] as $r) {
            if ((string) ($r['motif'] ?? '') !== '') {
                $remplacements[] = [mb_strtolower((string) $r['motif']), (string) ($r['partenaire'] ?? '')];
            }
        }
        $regles = [];
        foreach ($cfg['regles_agence'] ?? [] as $r) {
            $re = '~'.str_replace('~', '\~', (string) ($r['motif'] ?? '')).'~iu';
            if (@preg_match($re, '') !== false) {   // motif invalide : ignoré (le navigateur l'ignore aussi)
                $regles[] = [$re, (string) ($r['partenaire'] ?? '')];
            }
        }
        $defaut = (string) ($cfg['defaut'] ?? 'AUTRES');

        return static function (string $login, string $agence) use ($nominatif, $remplacements, $regles, $defaut): string {
            $v = trim($login);
            $reconnu = isset($nominatif[self::cleLogin($v)]);
            if ($reconnu) {
                $v = $nominatif[self::cleLogin($v)];
            }
            foreach ($remplacements as [$motif, $p]) {
                if (str_contains(mb_strtolower($v), $motif)) {
                    $v = $p;
                    $reconnu = true;
                }
            }
            if ($reconnu) {
                return $v;
            }
            foreach ($regles as [$re, $p]) {
                if (preg_match($re, trim($agence))) {
                    return $p;
                }
            }

            return $defaut;
        };
    }

    /** Clé de comparaison d'un login — même règle que CT.cleLogin (utils.js) : casse, « - » → « _ », « .ftth » final ignorés. */
    private static function cleLogin(string $login): string
    {
        return (string) preg_replace('/\.ftth$/', '', str_replace('-', '_', mb_strtolower(trim($login))));
    }
}
