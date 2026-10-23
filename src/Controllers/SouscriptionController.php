<?php

namespace App\Controllers;

use App\Config;
use App\Db;
use App\Http\HttpException;
use App\Http\Request;
use App\Http\Response;
use App\Http\Valider;
use App\Models\CeltiisData;
use App\Models\Import;
use App\Support\ExcelReader;

final class SouscriptionController
{
    /**
     * GET /api/souscriptions/periodes → mois disponibles en base (+ bornes de dates, volumes, dernier import).
     * Alimente le choix du mois et les bornes des filtres de date.
     *
     * « periode_defaut » : période affichée à l'ouverture quand l'utilisateur n'a choisi aucune date = celle du DERNIER
     * fichier importé avec succès (dates min / max de ses données). Les objectifs étant mensuels, le début est ramené au
     * 1er du mois de la date de fin (même règle que les filtres de l'interface). Sans import : le mois le plus récent en base.
     */
    public function periodes(): Response
    {
        $mois = Db::select('SELECT `mois`, COUNT(*) AS nb, MIN(`jour`) AS du, MAX(`jour`) AS au FROM `celtiis_datas` GROUP BY `mois` ORDER BY `mois`');
        $dernier = Import::dernierReussi('souscriptions');

        $defaut = null;
        if ($dernier && ! empty($dernier['stats']['au'])) {
            $au = $dernier['stats']['au'];
            $defaut = ['du' => max($dernier['stats']['du'] ?? $au, substr($au, 0, 7).'-01'), 'au' => $au, 'source' => 'dernier_import'];
        } elseif ($mois) {
            $derniereLigne = $mois[array_key_last($mois)];
            $defaut = ['du' => $derniereLigne['du'], 'au' => $derniereLigne['au'], 'source' => 'dernier_mois'];
        }

        return Response::json([
            'mois' => $mois,
            'du' => $mois ? min(array_column($mois, 'du')) : null,
            'au' => $mois ? max(array_column($mois, 'au')) : null,
            'periode_defaut' => $defaut,
            'dernier_import' => $dernier ? ['nom' => $dernier['nom_fichier'], 'date' => self::iso8601($dernier['created_at']), 'stats' => $dernier['stats']] : null,
        ]);
    }

    /**
     * GET /api/souscriptions?mois=2026-10&du=&au=&statut=OK,VALIDE&type_client=&agence=&login=&offre=
     *   • par défaut : liste paginée (per_page ≤ 500) ;
     *   • format=aoa : toutes les lignes filtrées, au format « tableau Excel » {entetes, lignes} que CT.parser.depuisAoa sait relire
     *     directement — le tableau de bord, Point du jour et Performance fonctionnent donc sans aucune modification.
     */
    public function index(Request $request): Response
    {
        $f = [
            'mois' => Valider::mois($request, 'mois'),
            'du' => Valider::date($request, 'du'),
            'au' => Valider::date($request, 'au'),
            'statut' => Valider::texte($request, 'statut'),
            'type_client' => Valider::texte($request, 'type_client'),
            'agence' => Valider::texte($request, 'agence'),
            'login' => Valider::texte($request, 'login'),
            'offre' => Valider::texte($request, 'offre'),
        ];
        $format = Valider::parmi($request, 'format', ['json', 'aoa']) ?? 'json';
        $parPage = Valider::entier($request, 'per_page', 1, 500) ?? 100;
        [$where, $params] = CeltiisData::filtrer($f);

        if ($format === 'aoa') {
            // Écrit ligne par ligne, requête non tamponnée : une période de plusieurs mois (100 000+ lignes) tient en mémoire
            $cols = Config::get('celtiis.colonnes');

            return Response::flux(static function () use ($cols, $where, $params): void {
                $options = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR;
                $pdo = Db::pdo();
                $tampon = $pdo->getAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);
                $pdo->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
                try {
                    $st = Db::requete('SELECT `raw` FROM `celtiis_datas`'.$where.' ORDER BY `date_commande`, `id`', $params);
                    echo '{"entetes":', json_encode($cols, $options), ',"lignes":[';
                    $premiere = true;
                    while ($r = $st->fetch()) {
                        $raw = json_decode($r['raw'] ?? '[]', true) ?: [];
                        echo $premiere ? '' : ',', json_encode(array_map(static fn ($c) => $raw[$c] ?? null, $cols), $options);
                        $premiere = false;
                    }
                    echo ']}';
                    $st->closeCursor();
                } finally {
                    $pdo->setAttribute(\PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, $tampon);
                }
            });
        }

        $total = (int) Db::value('SELECT COUNT(*) FROM `celtiis_datas`'.$where, $params);
        $page = max(1, (int) ($request->query('page') ?? 1));
        $donnees = Db::select(
            'SELECT `id`, `date_commande`, `jour`, `mois`, `id_client`, `msisdn`, `type_client`, `client_nom`, `statut`, `nom_offre`, `montant_total`, `agence`, `login_vendeur`, `nom_vendeur`, `source` FROM `celtiis_datas`'
            .$where.' ORDER BY `date_commande`, `id` LIMIT '.$parPage.' OFFSET '.(($page - 1) * $parPage),
            $params
        );
        foreach ($donnees as &$d) {
            $d['montant_total'] = (float) $d['montant_total'];
        }
        unset($d);
        $dernierePage = max(1, (int) ceil($total / $parPage));
        $chemin = self::urlCourante();
        $url = static function (int $p) use ($chemin): string {
            $q = $_GET;
            unset($q['route']);
            $q['page'] = $p;

            return $chemin.'?'.http_build_query($q);
        };
        $liens = [['url' => $page > 1 ? $url($page - 1) : null, 'label' => '&laquo; Previous', 'page' => $page > 1 ? $page - 1 : null, 'active' => false]];
        for ($p = 1; $p <= $dernierePage; $p++) {
            $liens[] = ['url' => $url($p), 'label' => (string) $p, 'page' => $p, 'active' => $p === $page];
        }
        $liens[] = ['url' => $page < $dernierePage ? $url($page + 1) : null, 'label' => 'Next &raquo;', 'page' => $page < $dernierePage ? $page + 1 : null, 'active' => false];

        return Response::json([
            'current_page' => $page,
            'data' => $donnees,
            'first_page_url' => $url(1),
            'from' => $donnees ? ($page - 1) * $parPage + 1 : null,
            'last_page' => $dernierePage,
            'last_page_url' => $url($dernierePage),
            'links' => $liens,
            'next_page_url' => $page < $dernierePage ? $url($page + 1) : null,
            'path' => $chemin,
            'per_page' => $parPage,
            'prev_page_url' => $page > 1 ? $url($page - 1) : null,
            'to' => $donnees ? ($page - 1) * $parPage + count($donnees) : null,
            'total' => $total,
        ]);
    }

    /**
     * POST /api/souscriptions — ajout MANUEL d'une ligne (même clé d'unicité que l'import).
     * 201 si créée ; 409 si (date, client, msisdn) existe déjà : jamais d'écrasement silencieux ni de doublon.
     */
    public function store(Request $request): Response
    {
        $v = [
            'date_commande' => Valider::texte($request, 'date_commande', true),
            'id_client' => Valider::texte($request, 'id_client', true, 40),
            'msisdn' => Valider::texte($request, 'msisdn', false, 40),
            'statut' => Valider::texte($request, 'statut', true, 20),
            'nom_offre' => Valider::texte($request, 'nom_offre', true, 255),
            'montant_total' => $request->input('montant_total'),
            'type_client' => Valider::texte($request, 'type_client', false, 20),
            'client_nom' => Valider::texte($request, 'client_nom', false, 255),
            'code' => Valider::texte($request, 'code', false, 40),
            'agence' => Valider::texte($request, 'agence', false, 120),
            'login_vendeur' => Valider::texte($request, 'login_vendeur', true, 120),
            'nom_vendeur' => Valider::texte($request, 'nom_vendeur', false, 120),
            'date_provisioning' => Valider::texte($request, 'date_provisioning'),
            'date_update' => Valider::texte($request, 'date_update'),
        ];
        if ($v['montant_total'] === null || $v['montant_total'] === '' || ! is_numeric($v['montant_total']) || (float) $v['montant_total'] < 0) {
            throw HttpException::validation('montant_total', 'Le champ montant_total doit être un nombre positif ou nul.');
        }

        $date = ExcelReader::date($v['date_commande']);
        if ($date === null) {
            return Response::json(['message' => 'DATE_COMMANDE invalide (attendu : AAAA-MM-JJ HH:MM:SS).', 'errors' => ['date_commande' => ['invalide']]], 422);
        }
        $v['date_commande'] = $date;
        $v['date_provisioning'] = ExcelReader::date($v['date_provisioning']);
        $v['date_update'] = ExcelReader::date($v['date_update']);
        $v['msisdn'] = $v['msisdn'] ?? '';

        [$id, $cree] = CeltiisData::ajouterManuellement($v);

        return $cree
            ? Response::json(['statut' => 'cree', 'id' => $id], 201)
            : Response::json(['statut' => 'existe_deja', 'message' => 'Une ligne avec la même date, le même client et le même MSISDN existe déjà.', 'id' => $id], 409);
    }

    /** URL absolue de la requête, sans paramètres (http(s)://hôte/…/api/souscriptions). */
    private static function urlCourante(): string
    {
        $https = ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';

        return ($https ? 'https' : 'http').'://'.($_SERVER['HTTP_HOST'] ?? 'localhost').strtok((string) ($_SERVER['REQUEST_URI'] ?? '/'), '?');
    }

    /** « 2026-10-20 22:17:12 » (UTC) → « 2026-10-20T22:17:12+00:00 » */
    public static function iso8601(?string $sql): ?string
    {
        return $sql === null ? null : date('c', (int) strtotime($sql.' UTC'));
    }
}
