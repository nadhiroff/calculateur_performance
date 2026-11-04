<?php

namespace App\Controllers;

use App\Config;
use App\Db;
use App\Http\Request;
use App\Http\Response;
use App\Http\Valider;
use App\Journal;
use App\Services\FactureImporter;
use App\Support\Televersement;
use InvalidArgumentException;
use PhpOffice\PhpSpreadsheet\Exception as SpreadsheetException;
use Throwable;

/** Facturation Celtiis : fichiers « POINT VENTES » de fin de mois (table factures_lignes). */
final class FactureController
{
    /**
     * Lignes retenues pour la facture : quand un fichier B2B a été envoyé à part pour le mois (source « b2b »), les quelques
     * ventes B2B présentes dans la liste B2C du même mois sont ignorées (le fichier B2B fait foi, aucune vente comptée deux fois).
     */
    private const RETENUES = "NOT (f.`source` <> 'b2b' AND f.`debit` IS NOT NULL AND f.`debit` NOT LIKE 'FTTH\\_HOME\\_%'
        AND EXISTS (SELECT 1 FROM `factures_lignes` x WHERE x.`mois` = f.`mois` AND x.`source` = 'b2b'))";

    /* POST /api/imports/factures   (multipart : fichier, [mois=AAAA-MM]) */
    public function importer(Request $request): Response
    {
        $f = Televersement::tableur($request);
        $mois = Valider::mois($request, 'mois', false);

        try {
            // apercu=1 : lecture et comparaison avec la base SANS rien écrire (fenêtre « Contrôle avant import ») ; sinon import
            $res = in_array((string) $request->input('apercu'), ['1', 'true'], true)
                ? (new FactureImporter())->apercu($f['chemin'], $f['nom'], $mois)
                : (new FactureImporter())->importer($f['chemin'], $f['nom'], $mois);
        } catch (InvalidArgumentException $e) {
            return Response::json(['message' => $e->getMessage()], 422);
        } catch (SpreadsheetException $e) {
            Journal::avertissement('Import facture : fichier illisible « '.$f['nom'].' » : '.$e->getMessage());

            return Response::json(['message' => 'Fichier illisible ou corrompu : « '.$f['nom'].' » n\'a pas pu être lu comme un classeur Excel. Aucune donnée n\'a été enregistrée.'], 422);
        } catch (Throwable $e) {
            Journal::exception($e);
            $detail = Config::get('app.debug') ? ' ('.mb_strimwidth($e->getMessage(), 0, 203, '...').')' : '';

            return Response::json(['message' => 'L\'import a échoué'.$detail.'. Aucune donnée n\'a été enregistrée.'], 500);
        }

        return Response::json($res);
    }

    /* GET /api/factures/mois : mois importés, avec leurs totaux et le dernier fichier */
    public function mois(Request $request): Response
    {
        $mois = Db::select(
            "SELECT `mois`, COUNT(*) AS `lignes`, SUM(`etat` = 'PAYE') AS `a_payer`, SUM(`etat` = 'REPORT_PAYE') AS `arrieres`,
                    SUM(`etat` = 'REPORTE') AS `reportees`, SUM(`etat` = 'NON_VALIDE') AS `non_validees`, MAX(`updated_at`) AS `maj`,
                    GROUP_CONCAT(DISTINCT `fichier` ORDER BY `fichier` SEPARATOR ' + ') AS `fichiers`
             FROM `factures_lignes` f WHERE ".self::RETENUES.' GROUP BY `mois` ORDER BY `mois`'
        );
        foreach ($mois as &$m) {
            foreach (['lignes', 'a_payer', 'arrieres', 'reportees', 'non_validees'] as $k) {
                $m[$k] = (int) $m[$k];
            }
        }

        return Response::json(['mois' => $mois]);
    }

    /* GET /api/factures/imports : historique des fichiers de facture (15 derniers), du plus récent au plus ancien */
    public function imports(Request $request): Response
    {
        $l = Db::select("SELECT `id`, `nom_fichier`, `statut`, `mois`, `stats`, `erreur`, `created_at` FROM `imports` WHERE `type` = 'factures' ORDER BY `id` DESC LIMIT 15");
        $l = array_map(static function (array $i) {
            $st = $i['stats'] === null ? [] : (json_decode((string) $i['stats'], true) ?: []);

            return ['id' => (int) $i['id'], 'nom' => $i['nom_fichier'], 'statut' => $i['statut'] === 'termine' ? 'ok' : $i['statut'], 'mois' => $i['mois'],
                'date' => SouscriptionController::iso8601($i['created_at']), 'erreur' => $i['erreur'] ? mb_substr($i['erreur'], 0, 200) : null,
                'facturees' => $st['facturees'] ?? null, 'a_payer' => $st['a_payer'] ?? null, 'arrieres' => $st['arrieres'] ?? null,
                'reportees' => $st['reportees'] ?? null, 'non_validees' => $st['non_validees'] ?? null, 'remplacees' => $st['remplacees'] ?? null,
                'changements' => $st['changements'] ?? null,
                'feuilles' => array_map(static fn (array $f) => $f['nom'].' ('.$f['lignes'].')', $st['feuilles'] ?? [])];
        }, $l);

        return Response::json(['imports' => $l]);
    }

    /* GET /api/factures/objectifs : objectif FTTH B2C de l'opérateur, par mois → { "2026-09": 1000, … } */
    public function objectifs(Request $request): Response
    {
        $o = [];
        foreach (Db::select('SELECT `mois`, `objectif_b2c` FROM `factures_objectifs` WHERE `objectif_b2c` IS NOT NULL ORDER BY `mois`') as $r) {
            $o[$r['mois']] = (int) $r['objectif_b2c'];
        }

        return Response::json(['objectifs' => (object) $o]);
    }

    /* PUT /api/factures/objectifs/{mois}   { "objectif_b2c": 1000 }  (null ou vide = effacer : facture sans la prime) */
    public function enregistrerObjectif(Request $request, string $mois): Response
    {
        if (! preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $mois)) {
            return Response::json(['message' => 'Mois invalide (format AAAA-MM).'], 422);
        }
        $v = $request->input('objectif_b2c');
        if ($v !== null && $v !== '' && (! is_numeric($v) || (int) $v < 0 || (int) $v != $v || (int) $v > 1000000)) {
            return Response::json(['message' => 'L\'objectif doit être un nombre entier de ventes (ex. 1000).'], 422);
        }
        $obj = $v === null || $v === '' ? null : (int) $v;
        $maintenant = Db::maintenant();
        Db::upsert('factures_objectifs', [['mois' => $mois, 'objectif_b2c' => $obj, 'created_at' => $maintenant, 'updated_at' => $maintenant]], ['objectif_b2c', 'updated_at']);

        return Response::json(['mois' => $mois, 'objectif_b2c' => $obj]);
    }

    /* GET /api/factures?mois=AAAA-MM : lignes du mois (sans la copie brute « donnees », inutile aux calculs) */
    public function lignes(Request $request): Response
    {
        $mois = Valider::mois($request, 'mois', true);
        $lignes = Db::select(
            'SELECT `id`, `liste`, `source`, `feuille`, `ligne`, `login`, `login_key`, `partenaire`, `facture`, `numero`, `montant`, `paiement`, `etat`,
                    `statut`, `type_client`, `debit`, `offre`, `date_commande`, `date_update`, `motif`
             FROM `factures_lignes` f WHERE f.`mois` = ? AND '.self::RETENUES.' ORDER BY `source`, `feuille`, `ligne`',
            [$mois]
        );
        foreach ($lignes as &$l) {
            $l['montant'] = $l['montant'] === null ? null : (float) $l['montant'];
        }

        return Response::json(['mois' => $mois, 'lignes' => $lignes]);
    }
}
