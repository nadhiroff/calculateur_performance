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
            $res = (new FactureImporter())->importer($f['chemin'], $f['nom'], $mois);
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
                'feuilles' => array_map(static fn (array $f) => $f['nom'].' ('.$f['lignes'].')', $st['feuilles'] ?? [])];
        }, $l);

        return Response::json(['imports' => $l]);
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
