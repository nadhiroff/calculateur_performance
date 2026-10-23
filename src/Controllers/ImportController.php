<?php

namespace App\Controllers;

use App\Config;
use App\Db;
use App\Http\HttpException;
use App\Http\Request;
use App\Http\Response;
use App\Http\Valider;
use App\Journal;
use App\Models\AppSetting;
use App\Models\Import;
use App\Models\MensualObjective;
use App\Models\MensualSetting;
use App\Services\CeltiisImporter;
use App\Services\ObjectifsDiff;
use App\Services\ObjectifsInvalidesException;
use App\Services\ObjectifsMapper;
use App\Services\ObjectifsValidator;
use App\Support\Televersement;
use InvalidArgumentException;
use PhpOffice\PhpSpreadsheet\Exception as SpreadsheetException;
use Throwable;

final class ImportController
{
    /* ====================================================================================
       POST /api/imports/souscriptions   (multipart : fichier, [forcer])
       Import périodique Celtiis, lu par lots : upsert sur (date_commande, id_client, msisdn). Gros fichiers acceptés.
       ==================================================================================== */
    public function souscriptions(Request $request): Response
    {
        $f = Televersement::tableur($request);

        // L'écriture se fait dans une transaction (CeltiisImporter) : toute exception ci-dessous l'a déjà annulée (rollBack),
        // la base reste exactement dans son état d'avant l'import.
        try {
            $res = (new CeltiisImporter())->importer($f['chemin'], $f['nom'], hash_file('sha256', $f['chemin']), $request->boolean('forcer'));
        } catch (InvalidArgumentException $e) {
            return Response::json(['message' => $e->getMessage()], 422);   // en-têtes / colonnes manquantes, aucune feuille exploitable
        } catch (SpreadsheetException $e) {
            Journal::avertissement('Import souscriptions : fichier illisible « '.$f['nom'].' » : '.$e->getMessage());

            return Response::json(['message' => 'Fichier illisible ou corrompu : « '.$f['nom'].' » n\'a pas pu être lu comme un classeur Excel/CSV. Aucune donnée n\'a été enregistrée.'], 422);
        } catch (Throwable $e) {
            Journal::exception($e);

            $detail = Config::get('app.debug') ? ' ('.mb_strimwidth($e->getMessage(), 0, 203, '...').')' : '';

            return Response::json(['message' => 'L\'import a échoué'.$detail.'. Aucune donnée n\'a été enregistrée : vérifiez le fichier puis réessayez.'], 500);
        }

        return Response::json($res, $res['statut'] === 'vide' ? 422 : 200);
    }

    /* ====================================================================================
       POST /api/imports/objectifs   (multipart : fichier, mois=AAAA-MM, [mise_a_jour])
       Ne modifie RIEN tant que le résultat est « confirmation_requise ».
         statut = cree                    → le mois n'avait aucun objectif : écrit directement
         statut = identique               → données strictement identiques : ignoré proprement
         statut = confirmation_requise    → différences (ou mise à jour demandée) : alerte + diff + token à confirmer
       ==================================================================================== */
    public function objectifs(Request $request): Response
    {
        $f = Televersement::tableur($request);
        $mois = Valider::mois($request, 'mois', true);
        $demandeMaj = $request->boolean('mise_a_jour');

        if (! MensualSetting::existe($mois)) {
            return Response::json(['message' => "Le mois $mois n'existe pas encore : créez-le d'abord avec « Nouveau mois »."], 422);
        }

        try {
            $analyse = (new ObjectifsValidator())->analyser($f['chemin']);   // lecture (valeurs des formules) + validation + diagnostic
        } catch (ObjectifsInvalidesException $e) {
            return Response::json(['message' => $e->getMessage(), 'details' => $e->details], 422);
        }

        $mapped = ObjectifsMapper::depuisEquipes($analyse['equipes']);
        $existantes = MensualObjective::duMois($mois);
        $diff = ObjectifsDiff::comparer($existantes, $mapped['lignes']);
        $base = [
            'mois' => $mois, 'equipes' => count($analyse['equipes']), 'logins' => $analyse['logins'],
            'avertissements' => array_merge($analyse['avertissements'], $mapped['avertissements']),
        ];
        $hash = hash_file('sha256', $f['chemin']);

        // Mois sans aucune ligne d'objectif : rien à écraser, pas de confirmation nécessaire
        if (! $existantes) {
            $this->appliquer($mois, $mapped['lignes'], $f['nom'], $hash, $diff['resume']);

            return Response::json($base + ['statut' => 'cree', 'diff' => ['resume' => $diff['resume']]]);
        }

        // Strictement identique et aucune demande explicite → on ignore proprement
        if ($diff['identique'] && ! $demandeMaj) {
            return Response::json($base + ['statut' => 'identique', 'message' => "Les objectifs importés sont identiques à ceux déjà enregistrés pour $mois : aucune modification."]);
        }

        // Différences détectées (ou mise à jour demandée) → résultat mis de côté, confirmation demandée à l'utilisateur
        $token = bin2hex(random_bytes(20));
        AppSetting::mettreDeCote($token, [
            'mois' => $mois, 'lignes' => $mapped['lignes'], 'resume' => $diff['resume'],
            'nom' => $f['nom'], 'hash' => $hash, 'version' => AppSetting::version(),
        ], 15);

        return Response::json($base + [
            'statut' => 'confirmation_requise',
            'token' => $token,
            'diff' => [
                'resume' => $diff['resume'],
                'modifies' => array_slice($diff['modifies'], 0, 200),
                'ajoutes' => array_slice($diff['ajoutes'], 0, 200),
                'supprimes' => array_slice($diff['supprimes'], 0, 200),
            ],
        ]);
    }

    /* ====================================================================================
       POST /api/imports/objectifs/confirmer   (json : token)
       Applique réellement la mise à jour (upsert + suppression des lignes disparues) après accord de l'utilisateur.
       ==================================================================================== */
    public function confirmerObjectifs(Request $request): Response
    {
        $token = Valider::texte($request, 'token', true);
        if (strlen($token) !== 40) {
            throw HttpException::validation('token', 'Le champ token doit contenir 40 caractères.');
        }
        $p = AppSetting::reprendre($token);

        if (! $p) {
            return Response::json(['message' => 'La demande a expiré (15 min) : réimportez le fichier.'], 410);
        }
        if ($p['version'] !== AppSetting::version()) {
            return Response::json(['message' => 'Les paramètres ont été modifiés entre-temps (autre onglet ou autre utilisateur) : réimportez le fichier pour comparer à jour.'], 409);
        }

        $this->appliquer($p['mois'], $p['lignes'], $p['nom'], $p['hash'], $p['resume']);

        return Response::json(['statut' => 'mis_a_jour', 'mois' => $p['mois'], 'diff' => ['resume' => $p['resume']]]);
    }

    /**
     * Écriture transactionnelle : upsert des lignes importées (superviseur/segment conservés), suppression des lignes disparues, journal.
     *
     * @param  array<int, array<string, mixed>>  $lignes
     * @param  array<string, int>  $resume
     */
    private function appliquer(string $mois, array $lignes, string $nom, string $hash, array $resume): void
    {
        Db::transaction(function () use ($mois, $lignes, $nom, $hash, $resume) {
            MensualObjective::appliquer($mois, $lignes, avecManuel: false, supprimerAbsentes: true);
            Import::creer(['type' => 'objectifs', 'nom_fichier' => $nom, 'file_hash' => $hash, 'statut' => 'ok', 'mois' => $mois, 'stats' => $resume]);
            AppSetting::incrementerVersion();
        });
    }
}
