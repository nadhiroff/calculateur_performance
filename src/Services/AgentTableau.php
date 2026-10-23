<?php

namespace App\Services;

use App\Db;
use App\Models\CalcRule;
use App\Models\MensualObjective;
use App\Models\MensualSetting;
use App\Support\Cache;
use App\Support\LoginKey;

/**
 * Espace commercial RGZ : résultats d'UN login et de SON équipe, calculés côté serveur.
 * Le navigateur du commercial ne reçoit jamais les ventes des autres : seulement des totaux par membre de son équipe.
 *
 * Mêmes règles que le tableau de bord RGZ (calculs.js → motivation()) pour le mois de la date de fin :
 *   ventes comptées = statut dans regles.statuts_comptes ; B2B = TYPE_CLIENT égal à regles.segment_b2b.valeur ;
 *   objectif jour = valeur du fichier, ou objectif du mois ÷ jours ouvrés (mode « calcul » ou valeur absente) ;
 *   objectif à date = arrondi(objectif jour × jours ouvrés écoulés) ; TRO = ventes du mois ÷ objectif du mois ;
 *   journée réussie = jour ouvré où ventes ≥ objectif jour ; champion du jour = meilleur ratio ventes / objectif jour (tout RGZ) ;
 *   primes = palier de TRO + journées réussies + champion du jour + bonus B2B (objectif B2B atteint).
 * Paramètres d'un mois absent : ceux du mois antérieur le plus proche, calendrier lundi → vendredi (comme store.js) ;
 * avant le premier mois configuré : aucun objectif.
 */
final class AgentTableau
{
    /** Plus longue période consultable d'un coup (jours). */
    public const PERIODE_MAX = 93;

    private const LISTE_MAX = 500;

    /** @return array<string, mixed> */
    public function calculer(string $cleAgent, string $du, string $au): array
    {
        // Partie commune à tous les commerciaux (identique pour tous sur une même période) : calculée une fois, puis relue
        // en cache ; la version des données dans la clé la renouvelle à chaque import / modification des paramètres.
        $c = Cache::memoriser('agent-commun-v3:'.$du.':'.$au.':'.Cache::version(), 600, static fn () => self::commun($du, $au));
        ['mois' => $mois, 'debutMois' => $debutMois, 'p' => $p, 'agents' => $agents, 'parJour' => $parJour, 'ouvresEcoules' => $ouvresEcoules] = $c;
        $R = $p['regles'];
        $statuts = array_values(array_map('strval', $R['statuts_comptes'] ?? ['OK']));
        $valeurB2B = mb_strtoupper((string) ($R['segment_b2b']['valeur'] ?? 'ORGANISATION'));
        $A = $R['agent'] ?? [];
        $ouvres = array_map('intval', $p['calendrier']['ouvres'] ?? []);
        $estOuvre = static fn (string $j): bool => substr($j, 0, 7) === $mois && in_array((int) substr($j, 8, 2), $ouvres, true);

        $moi = $agents[$cleAgent] ?? null;
        $equipeNom = $moi['equipe'] ?? self::derniereEquipe($cleAgent);
        if ($moi === null) {
            // Commercial absent des objectifs du mois : ses propres ventes ne sont pas dans la partie commune
            $parJour[$cleAgent] = self::ventesParJour([$cleAgent], min($du, $debutMois), $au, $statuts, $valeurB2B)[$cleAgent] ?? [];
        }
        $somme = static function (string $cle, string $de, string $a, int $col = 0) use ($parJour): int {
            $t = 0;
            foreach ($parJour[$cle] ?? [] as $j => $v) {
                if ($j >= $de && $j <= $a) {
                    $t += $v[$col];
                }
            }

            return $t;
        };

        // Rangs parmi les commerciaux éligibles aux primes (classement commun déjà trié : TRO puis ventes)
        $rangReseau = array_flip($c['classement']);
        $classementEquipe = array_values(array_filter($c['classement'], static fn ($k) => $agents[$k]['equipe'] === $equipeNom));
        $rangEquipe = array_flip($classementEquipe);
        $eligibles = $c['classement'];
        $eligiblesEquipe = $classementEquipe;

        // ---- Mon tableau ----
        $lundi = date('Y-m-d', strtotime($au.' -'.((int) date('N', strtotime($au)) - 1).' days'));
        $objJour = $moi['objJour'] ?? 0.0;
        $joursPeriode = self::jours($du, $au);
        $objJours = self::objectifsParJour($cleAgent, $du, $au);
        $statutsPeriode = [];
        foreach (Db::select('SELECT `statut`, COUNT(*) AS n FROM `celtiis_datas` WHERE `login_key` = ? AND `jour` BETWEEN ? AND ? GROUP BY `statut` ORDER BY n DESC', [$cleAgent, $du, $au]) as $r) {
            $statutsPeriode[(string) $r['statut']] = (int) $r['n'];
        }
        $attente = array_sum(array_diff_key($statutsPeriode, array_flip($statuts)));

        $mesVentes = $somme($cleAgent, $du, $au);
        $mesB2B = $somme($cleAgent, $du, $au, 1);
        $monMois = $moi ? self::resumeMois($moi, $A, $ouvresEcoules, count(array_filter(self::jours($debutMois, date('Y-m-t', strtotime($debutMois))), $estOuvre))) : null;

        $tableau = [
            'agent' => ['login' => $moi['login'] ?? $cleAgent, 'cle' => $cleAgent, 'equipe' => $equipeNom, 'objectif' => $moi !== null],
            'periode' => ['du' => $du, 'au' => $au, 'mois' => $mois],
            'moi' => [
                'periode' => [
                    'ventes' => $mesVentes, 'b2b' => $mesB2B, 'b2c' => $mesVentes - $mesB2B,
                    'attente' => $attente, 'attente_detail' => array_diff_key($statutsPeriode, array_flip($statuts)),
                    'objectif' => $objJours ? round(array_sum($objJours), 2) : null,
                    'jours' => array_map(static fn (string $j) => [
                        'jour' => $j, 'ventes' => $parJour[$cleAgent][$j][0] ?? 0, 'objectif' => isset($objJours[$j]) ? round($objJours[$j], 2) : null,
                    ], $joursPeriode),
                ],
                'jour' => ['date' => $au, 'ventes' => $somme($cleAgent, $au, $au), 'objectif' => $estOuvre($au) && $objJour > 0 ? round($objJour, 2) : null],
                'semaine' => ['depuis' => max($lundi, $debutMois), 'ventes' => $somme($cleAgent, max($lundi, $debutMois), $au), 'objectif' => $moi && $moi['objSemaine'] > 0 ? round($moi['objSemaine'], 2) : null],
                'mois' => $monMois,
                'rang' => [
                    'reseau' => isset($rangReseau[$cleAgent]) ? $rangReseau[$cleAgent] + 1 : null, 'sur_reseau' => count($eligibles),
                    'equipe' => isset($rangEquipe[$cleAgent]) ? $rangEquipe[$cleAgent] + 1 : null, 'sur_equipe' => count($eligiblesEquipe),
                ],
            ],
            'equipe' => self::equipe($equipeNom, $agents, $p, $ouvresEcoules, $cleAgent, $du, $au, $somme),
            'ventes' => self::liste($cleAgent, $du, $au, $statuts, $valeurB2B),
            'calendrier' => ['ouvres_ecoules' => $ouvresEcoules, 'herite' => $p['herite']],
        ];

        // ---- Données de motivation et informations d'équipe (totaux et classements seulement) ----
        $ouvresMois = count(array_filter(self::jours($debutMois, date('Y-m-t', strtotime($debutMois))), $estOuvre));
        $tableau['motivation'] = self::motivation($moi, $A, $parJour, $cleAgent, $debutMois, $au, $estOuvre, $ouvresEcoules, $ouvresMois, $c['champions'], $agents);
        $tableau['equipes'] = self::equipes($agents, $equipeNom);
        $membres = array_keys(array_filter($agents, static fn (array $a) => $a['equipe'] === $equipeNom));
        $rangEq = array_search(true, array_column($tableau['equipes'], 'moi'), true);
        $tableau['equipe'] += [
            'rang' => $rangEq === false ? null : $rangEq + 1, 'nb_equipes' => count($tableau['equipes']),
            'ma_part' => $moi && $tableau['equipe']['mois']['ventes'] > 0 ? round($moi['real'] / $tableau['equipe']['mois']['ventes'], 4) : null,
            'moyenne' => $membres ? round($tableau['equipe']['mois']['ventes'] / count($membres), 1) : null,
            'jours' => array_map(static function (string $j) use ($membres, $parJour) {
                $t = 0;
                foreach ($membres as $k) {
                    $t += $parJour[$k][$j][0] ?? 0;
                }

                return ['jour' => $j, 'ventes' => $t];
            }, self::jours($debutMois, $au)),
        ];

        return $tableau;
    }

    /**
     * Calcul commun à tous les commerciaux pour une période : paramètres du mois, ventes de tout RGZ par jour,
     * réalisé du mois, journées réussies, champion du jour et classement. Résultat mis en cache (JSON).
     *
     * @return array<string, mixed>
     */
    private static function commun(string $du, string $au): array
    {
        $mois = substr($au, 0, 7);
        $debutMois = $mois.'-01';
        $p = self::parametres($mois);
        $R = $p['regles'];
        $statuts = array_values(array_map('strval', $R['statuts_comptes'] ?? ['OK']));
        $valeurB2B = mb_strtoupper((string) ($R['segment_b2b']['valeur'] ?? 'ORGANISATION'));
        $ouvres = array_map('intval', $p['calendrier']['ouvres'] ?? []);
        $estOuvre = static fn (string $j): bool => substr($j, 0, 7) === $mois && in_array((int) substr($j, 8, 2), $ouvres, true);
        $joursMois = self::jours($debutMois, $au);
        $ouvresEcoules = count(array_filter($joursMois, $estOuvre));

        // Tous les commerciaux RGZ du mois (nécessaires au champion du jour et au rang), dans l'ordre des objectifs
        $agents = self::agentsDuMois($p);
        $parJour = $agents ? self::ventesParJour(array_keys($agents), min($du, $debutMois), $au, $statuts, $valeurB2B) : [];
        $somme = static function (string $cle, string $de, string $a, int $col = 0) use ($parJour): int {
            $t = 0;
            foreach ($parJour[$cle] ?? [] as $j => $v) {
                if ($j >= $de && $j <= $a) {
                    $t += $v[$col];
                }
            }

            return $t;
        };

        // ---- Mois (du 1er à la date de fin) : réalisé, journées réussies, champion du jour ----
        $champions = [];   // jour → clé du champion RGZ du jour
        foreach ($agents as $k => &$a) {
            $a['real'] = $somme($k, $debutMois, $au);
            $a['realB2B'] = $somme($k, $debutMois, $au, 1);
            $a['realB2C'] = $a['real'] - $a['realB2B'];
            $a['journees'] = 0;
            $a['champion'] = 0;
        }
        unset($a);
        foreach ($joursMois as $j) {
            if (! $estOuvre($j)) {
                continue;
            }
            $meilleur = null;
            foreach ($agents as $k => &$a) {
                $v = $parJour[$k][$j][0] ?? 0;
                if ($a['primes'] && $a['objJour'] > 0 && $v + 1e-9 >= $a['objJour']) {
                    $a['journees']++;
                    $ratio = $v / $a['objJour'];
                    if ($meilleur === null || $ratio > $meilleur[1] + 1e-9 || (abs($ratio - $meilleur[1]) < 1e-9 && $v > $meilleur[2])) {
                        $meilleur = [$k, $ratio, $v];
                    }
                }
            }
            unset($a);
            if ($meilleur !== null) {
                $agents[$meilleur[0]]['champion']++;
                $champions[$j] = (string) $meilleur[0];
            }
        }
        foreach ($agents as &$a) {
            $a['objADate'] = (int) round($a['objJour'] * $ouvresEcoules);
            $a['tro'] = $a['objMois'] > 0 ? $a['real'] / $a['objMois'] : 0.0;
        }
        unset($a);

        $eligibles = array_filter($agents, static fn (array $a) => $a['primes']);
        uasort($eligibles, static fn (array $x, array $y) => [$y['tro'], $y['real']] <=> [$x['tro'], $x['real']]);

        return [
            'mois' => $mois, 'debutMois' => $debutMois, 'p' => $p, 'agents' => $agents, 'parJour' => $parJour,
            'ouvresEcoules' => $ouvresEcoules, 'classement' => array_map('strval', array_keys($eligibles)), 'champions' => $champions,
        ];
    }

    /**
     * Ventes comptées par login et par jour : clé → jour → [ventes, dont B2B].
     *
     * @param  string[]  $cles
     * @param  string[]  $statuts
     * @return array<string, array<string, array{0: int, 1: int}>>
     */
    private static function ventesParJour(array $cles, string $du, string $au, array $statuts, string $valeurB2B): array
    {
        $out = [];
        foreach (Db::select(
            'SELECT `login_key`, `jour`, COUNT(*) AS n, SUM(UPPER(COALESCE(`type_client`, \'\')) = ?) AS b2b FROM `celtiis_datas`'
            .' WHERE `jour` BETWEEN ? AND ? AND `statut` IN ('.Db::marques(count($statuts)).') AND `login_key` IN ('.Db::marques(count($cles)).')'
            .' GROUP BY `login_key`, `jour`',
            [$valeurB2B, $du, $au, ...$statuts, ...$cles]
        ) as $r) {
            $out[$r['login_key']][$r['jour']] = [(int) $r['n'], (int) $r['b2b']];
        }

        return $out;
    }

    /**
     * Encouragements : calendrier du mois, record, séries, projection de fin de mois, échelle des paliers, champion du jour.
     *
     * @param  array<string, mixed>|null  $moi
     * @param  array<string, mixed>  $A  règles « agent »
     * @param  array<string, array<string, array{0: int, 1: int}>>  $parJour
     * @param  array<string, string>  $champions
     * @param  array<string, array<string, mixed>>  $agents
     * @return array<string, mixed>
     */
    private static function motivation(?array $moi, array $A, array $parJour, string $cle, string $debutMois, string $au, callable $estOuvre, int $ouvresEcoules, int $ouvresMois, array $champions, array $agents): array
    {
        $objJour = $moi['objJour'] ?? 0.0;
        $v = static fn (string $j): int => $parJour[$cle][$j][0] ?? 0;
        $calendrier = array_map(static fn (string $j) => [
            'jour' => $j, 'ventes' => $j <= $au ? $v($j) : null, 'ouvre' => $estOuvre($j), 'futur' => $j > $au,
            'reussi' => $j <= $au && $estOuvre($j) && $objJour > 0 && $v($j) + 1e-9 >= $objJour,
        ], self::jours($debutMois, date('Y-m-t', strtotime($debutMois))));

        $record = null;
        foreach ($calendrier as $c) {
            if (! $c['futur'] && $c['ventes'] > 0 && ($record === null || $c['ventes'] > $record['ventes'])) {
                $record = ['jour' => $c['jour'], 'ventes' => $c['ventes']];
            }
        }
        // Séries en cours : jours ouvrés consécutifs (en remontant depuis la date de fin) avec au moins une vente / objectif atteint
        $serieVente = $serieReussie = 0;
        $finVente = $finReussie = false;
        foreach (array_reverse(array_filter($calendrier, static fn (array $c) => ! $c['futur'] && $c['ouvre'])) as $c) {
            $finVente = $finVente || $c['ventes'] < 1;
            $finReussie = $finReussie || ! $c['reussi'];
            $serieVente += $finVente ? 0 : 1;
            $serieReussie += $finReussie ? 0 : 1;
        }

        $paliers = $A['paliers_tro'] ?? [];
        usort($paliers, static fn (array $x, array $y) => $x['seuil'] <=> $y['seuil']);
        $objMois = $moi['objMois'] ?? 0;
        $palierDe = static function (float $tro) use ($paliers): ?array {
            $r = null;
            foreach ($paliers as $pl) {
                if ($tro + 1e-9 >= $pl['seuil']) {
                    $r = $pl;
                }
            }

            return $r;
        };

        $projection = null;
        if ($moi && $objMois > 0) {
            $restants = max(0, $ouvresMois - $ouvresEcoules);
            $rythme = $ouvresEcoules > 0 ? $moi['real'] / $ouvresEcoules : 0.0;
            $fin = (int) round($moi['real'] + $rythme * $restants);
            $palierFin = $moi['primes'] ? $palierDe($fin / $objMois) : null;
            $reste = max(0, $objMois - $moi['real']);
            $projection = [
                'ouvres_restants' => $restants, 'rythme' => round($rythme, 2), 'fin_de_mois' => $fin, 'tro' => round($fin / $objMois, 4),
                'palier' => $palierFin['nom'] ?? null, 'prime_palier' => (int) ($palierFin['prime'] ?? 0),
                'par_jour' => $reste > 0 && $restants > 0 ? (int) ceil($reste / $restants) : 0, 'reste' => $reste,
            ];
        }

        $champion = null;
        krsort($champions);
        foreach ($champions as $j => $k) {
            if ($j <= $au && isset($agents[$k])) {
                $champion = ['jour' => $j, 'login' => $agents[$k]['login'], 'equipe' => $agents[$k]['equipe'], 'ventes' => $parJour[$k][$j][0] ?? 0, 'moi' => $k === $cle];
                break;
            }
        }

        return [
            'calendrier' => $calendrier, 'record' => $record, 'serie_vente' => $serieVente, 'serie_reussie' => $serieReussie,
            'projection' => $projection, 'champion' => $champion,
            'paliers' => array_map(static fn (array $pl) => [
                'nom' => $pl['nom'], 'seuil' => $pl['seuil'], 'prime' => (int) $pl['prime'],
                'ventes' => $objMois > 0 ? (int) ceil($pl['seuil'] * $objMois - 1e-9) : null,
                'atteint' => $moi !== null && $moi['primes'] && $moi['tro'] + 1e-9 >= $pl['seuil'],
            ], $paliers),
        ];
    }

    /**
     * Classement des équipes RGZ du mois (nom, effectif, ventes, objectif, taux) : aucune donnée individuelle.
     *
     * @param  array<string, array<string, mixed>>  $agents
     * @return array<int, array<string, mixed>>
     */
    private static function equipes(array $agents, ?string $mienne): array
    {
        $eq = [];
        foreach ($agents as $a) {
            $e = &$eq[$a['equipe']];
            $e ??= ['nom' => $a['equipe'], 'membres' => 0, 'ventes' => 0, 'objectif' => 0];
            $e['membres']++;
            $e['ventes'] += $a['real'];
            $e['objectif'] += $a['objMois'];
            unset($e);
        }
        $liste = array_map(static fn (array $e) => $e + ['tro' => $e['objectif'] > 0 ? round($e['ventes'] / $e['objectif'], 4) : 0, 'moi' => $e['nom'] === $mienne], array_values($eq));
        usort($liste, static fn (array $x, array $y) => [$y['objectif'] > 0, $y['tro'], $y['ventes']] <=> [$x['objectif'] > 0, $x['tro'], $x['ventes']]);

        return $liste;
    }

    /**
     * Mois en cours d'un commercial : objectifs, TRO, rythme, primes estimées et prochain palier.
     *
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $A  règles « agent »
     * @return array<string, mixed>
     */
    private static function resumeMois(array $a, array $A, int $ouvresEcoules, int $ouvresMois): array
    {
        $paliers = $A['paliers_tro'] ?? [];
        usort($paliers, static fn (array $x, array $y) => $x['seuil'] <=> $y['seuil']);
        $palier = null;
        $suivant = null;
        foreach ($paliers as $pl) {
            if ($a['tro'] + 1e-9 >= $pl['seuil']) {
                $palier = $pl;
            } elseif ($suivant === null) {
                $suivant = $pl;
            }
        }
        $primePalier = $a['primes'] && $palier ? (int) $palier['prime'] : 0;
        $primeJournees = $a['primes'] ? $a['journees'] * (int) ($A['journee_reussie'] ?? 0) : 0;
        $primeChampion = $a['primes'] ? $a['champion'] * (int) ($A['champion_du_jour']['prime'] ?? 0) : 0;
        $bonusB2B = $a['primes'] && $a['objB2B'] > 0 && $a['realB2B'] >= $a['objB2B'] ? (int) ($A['bonus_b2b'] ?? 0) : 0;

        return [
            'ventes' => $a['real'], 'b2c' => $a['realB2C'], 'b2b' => $a['realB2B'],
            'objectif' => $a['objMois'], 'obj_b2c' => $a['objB2C'], 'obj_b2b' => $a['objB2B'],
            'obj_a_date' => $a['objADate'], 'ecart' => $a['real'] - $a['objADate'], 'tro' => round($a['tro'], 4),
            'reste' => max(0, $a['objMois'] - $a['real']), 'obj_jour' => round($a['objJour'], 2),
            'ouvres_ecoules' => $ouvresEcoules, 'ouvres_mois' => $ouvresMois,
            'primes' => [
                'eligible' => $a['primes'],
                'palier' => $a['primes'] && $palier ? $palier['nom'] : null, 'prime_palier' => $primePalier,
                'journees' => $a['journees'], 'prime_journees' => $primeJournees, 'prime_journee' => (int) ($A['journee_reussie'] ?? 0),
                'champion' => $a['champion'], 'prime_champion' => $primeChampion,
                'bonus_b2b' => $bonusB2B, 'bonus_b2b_possible' => $a['primes'] && $a['objB2B'] > 0 ? (int) ($A['bonus_b2b'] ?? 0) : 0,
                'total' => $primePalier + $primeJournees + $primeChampion + $bonusB2B,
                'suivant' => $a['primes'] && $suivant && $a['objMois'] > 0 ? [
                    'nom' => $suivant['nom'], 'prime' => (int) $suivant['prime'], 'seuil' => $suivant['seuil'],
                    'manque' => max(0, (int) ceil($suivant['seuil'] * $a['objMois'] - 1e-9) - $a['real']),
                ] : null,
            ],
        ];
    }

    /**
     * Mon équipe : totaux du mois et de la période, classement des membres (totaux seulement, jamais le détail des ventes).
     *
     * @param  array<string, array<string, mixed>>  $agents
     * @param  array<string, mixed>  $p
     * @return array<string, mixed>
     */
    private static function equipe(?string $nom, array $agents, array $p, int $ouvresEcoules, string $cleAgent, string $du, string $au, callable $somme): array
    {
        $membres = array_filter($agents, static fn (array $a) => $a['equipe'] === $nom);
        $objJour = 0.0;
        foreach ($p['objectifs']['equipes'] ?? [] as $e) {
            if ($e['id'] === $nom) {
                $objJour = self::modeCalcul($p) || ! ((float) ($e['jour'] ?? 0) > 0)
                    ? (self::modeCalcul($p) ? self::calcJour(array_sum(array_column($membres, 'objMois')), $p) : array_sum(array_column($membres, 'objJour')))
                    : (float) $e['jour'];
            }
        }
        $liste = [];
        foreach ($membres as $k => $a) {
            $liste[] = [
                'login' => $a['login'], 'moi' => $k === $cleAgent, 'ventes_periode' => $somme($k, $du, $au),
                'ventes_mois' => $a['real'], 'objectif' => $a['objMois'], 'tro' => round($a['tro'], 4),
            ];
        }
        usort($liste, static fn (array $x, array $y) => [$y['tro'], $y['ventes_mois']] <=> [$x['tro'], $x['ventes_mois']]);
        $real = array_sum(array_column($liste, 'ventes_mois'));
        $obj = array_sum(array_column($liste, 'objectif'));

        return [
            'nom' => $nom,
            'mois' => ['ventes' => $real, 'objectif' => $obj, 'tro' => $obj > 0 ? round($real / $obj, 4) : 0, 'obj_a_date' => (int) round($objJour * $ouvresEcoules)],
            'periode' => ['ventes' => array_sum(array_column($liste, 'ventes_periode'))],
            'membres' => $liste,
        ];
    }

    /**
     * Détail de mes ventes de la période (nom complet du client, espaces et retours à la ligne normalisés).
     *
     * @param  string[]  $statuts
     * @return array<int, array<string, mixed>>
     */
    private static function liste(string $cle, string $du, string $au, array $statuts, string $valeurB2B): array
    {
        return array_map(static fn (array $r) => [
            'date' => $r['date_commande'], 'offre' => $r['nom_offre'],
            'segment' => mb_strtoupper((string) $r['type_client']) === $valeurB2B ? 'B2B' : 'B2C',
            'statut' => $r['statut'], 'compte' => in_array($r['statut'], $statuts, true),
            'montant' => (float) $r['montant_total'], 'client' => trim((string) preg_replace('/\s+/u', ' ', (string) $r['client_nom'])) ?: '—',
        ], Db::select(
            'SELECT `date_commande`, `nom_offre`, `type_client`, `statut`, `montant_total`, `client_nom` FROM `celtiis_datas`'
            .' WHERE `login_key` = ? AND `jour` BETWEEN ? AND ? ORDER BY `date_commande` DESC LIMIT '.self::LISTE_MAX,
            [$cle, $du, $au]
        ));
    }


    /**
     * Commerciaux du mois, clé de login → objectifs (même conversion que objectifs.js → indexLogins).
     *
     * @param  array<string, mixed>  $p
     * @return array<string, array<string, mixed>>
     */
    private static function agentsDuMois(array $p): array
    {
        $agents = [];
        foreach ($p['objectifs']['equipes'] ?? [] as $e) {
            foreach ($e['logins'] ?? [] as $l) {
                $b2c = (int) ($l['b2c'] ?? 0);
                $b2b = (int) ($l['b2b'] ?? 0);
                $mois = $b2c + $b2b;
                $agents[LoginKey::from($l['login'])] = [
                    'login' => $l['login'], 'equipe' => $e['id'], 'objB2C' => $b2c, 'objB2B' => $b2b, 'objMois' => $mois,
                    'objJour' => self::modeCalcul($p) || ! ((float) ($l['jour'] ?? 0) > 0) ? self::calcJour($mois, $p) : (float) $l['jour'],
                    'objSemaine' => self::modeCalcul($p) || ! ((float) ($l['semaine'] ?? 0) > 0) ? $mois / 4 : (float) $l['semaine'],
                    'primes' => ($l['primes'] ?? true) !== false && $mois > 0,
                ];
            }
        }

        return $agents;
    }

    /** @param array<string, mixed> $p */
    private static function modeCalcul(array $p): bool
    {
        return ($p['calendrier']['mode_jour'] ?? null) === 'calcul';
    }

    /** @param array<string, mixed> $p */
    private static function calcJour(float|int $mois, array $p): float
    {
        $base = (float) ($p['calendrier']['base_jour'] ?? 0) > 0 ? (float) $p['calendrier']['base_jour'] : count($p['calendrier']['ouvres'] ?? []);

        return $base > 0 ? $mois / $base : 0.0;
    }

    /**
     * Objectifs, calendrier et règles actifs pour un mois (héritage du mois antérieur le plus proche, sinon du premier mois
     * configuré, comme store.js).
     *
     * @return array{objectifs: array<string, mixed>, calendrier: array<string, mixed>, regles: array<string, mixed>, herite: bool}
     */
    public static function parametres(string $mois): array
    {
        $tous = array_column(MensualSetting::tous(), 'objectifs_meta', 'mois');
        $cles = array_keys($tous);
        sort($cles);
        // Mois configuré le plus proche avant ; un mois d'avant toute configuration prend le premier mois connu (comme store.js)
        $anterieurs = array_values(array_filter($cles, static fn (string $k) => $k <= $mois));
        $source = $anterieurs ? end($anterieurs) : ($cles[0] ?? null);
        if ($source === null) {
            return ['objectifs' => ['equipes' => []], 'calendrier' => ['ouvres' => self::ouvresDefaut($mois)], 'regles' => [], 'herite' => true];
        }

        $meta = $tous[$source] ?? [];
        $calendrier = $meta['calendrier'] ?? [];
        if ($source !== $mois) {
            $calendrier = ['ouvres' => self::ouvresDefaut($mois)] + array_intersect_key($calendrier, ['mode_jour' => 1, 'base_jour' => 1]);
        }
        $regles = CalcRule::pourMois($source);

        return [
            'objectifs' => ['equipes' => ObjectifsMapper::versEquipes(MensualObjective::duMois($source))],
            'calendrier' => $calendrier,
            'regles' => $regles ? json_decode((string) json_encode($regles), true) : [],
            'herite' => $source !== $mois,
        ];
    }

    /**
     * Objectif du jour d'un commercial pour chaque jour ouvré de [du → au], avec les objectifs DU MOIS de chaque jour :
     * sur une période à cheval sur plusieurs mois, l'objectif de la période est la somme, mois par mois.
     *
     * @return array<string, float>  jour → objectif (jours ouvrés où le commercial a un objectif)
     */
    private static function objectifsParJour(string $cleAgent, string $du, string $au): array
    {
        $out = [];
        for ($m = substr($du, 0, 7); $m <= substr($au, 0, 7); $m = date('Y-m', strtotime($m.'-01 +1 month'))) {
            $p = self::parametres($m);
            $obj = self::agentsDuMois($p)[$cleAgent]['objJour'] ?? 0.0;
            if ($obj <= 0) {
                continue;
            }
            $ouvres = array_map('intval', $p['calendrier']['ouvres'] ?? []);
            foreach (self::jours(max($du, $m.'-01'), min($au, date('Y-m-t', strtotime($m.'-01')))) as $j) {
                if (in_array((int) substr($j, 8, 2), $ouvres, true)) {
                    $out[$j] = $obj;
                }
            }
        }

        return $out;
    }

    /** Équipe la plus récente d'un login (commercial absent des objectifs du mois demandé). */
    private static function derniereEquipe(string $cle): ?string
    {
        $e = Db::value("SELECT `equipe` FROM `mensual_objectives` WHERE `niveau` = 'login' AND `cle` = ? ORDER BY `mois` DESC LIMIT 1", [$cle]);

        return $e === null ? null : (string) $e;
    }

    /** @return int[] jours du lundi au vendredi */
    private static function ouvresDefaut(string $mois): array
    {
        return array_values(array_map(static fn (string $j) => (int) substr($j, 8, 2), array_filter(
            self::jours($mois.'-01', date('Y-m-t', strtotime($mois.'-01'))),
            static fn (string $j) => (int) date('N', strtotime($j)) <= 5
        )));
    }

    /** @return string[] jours « AAAA-MM-JJ » de $du à $au inclus */
    private static function jours(string $du, string $au): array
    {
        $out = [];
        for ($t = strtotime($du); $t <= strtotime($au); $t = strtotime('+1 day', $t)) {
            $out[] = date('Y-m-d', $t);
        }

        return $out;
    }
}
