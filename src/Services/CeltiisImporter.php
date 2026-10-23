<?php

namespace App\Services;

use App\Config;
use App\Db;
use App\Journal;
use App\Models\CeltiisData;
use App\Models\Import;
use App\Support\Cache;
use App\Support\ExcelReader;
use InvalidArgumentException;
use Throwable;

/**
 * Import périodique Celtiis (toutes les 1 à 2 semaines) — conçu pour les GROS fichiers (20 Mo et plus).
 *
 * Le fichier est lu par LOTS de N lignes (config celtiis.lot_lignes) ; chaque lot est classé puis écrit avant de passer
 * au suivant : la mémoire reste bornée quelle que soit la taille du fichier. Tout se déroule dans UNE transaction :
 * en cas d'erreur à mi-parcours, rien n'est écrit (pas d'import à moitié fait).
 *
 * Règle : la CLÉ (date_commande, id_client, msisdn) identifie une ligne ; ses autres champs peuvent évoluer
 * (ex. STATUS VALIDE → OK dans un fichier ultérieur). Pour chaque ligne du fichier :
 *   • clé inconnue                       → INSERT                       (« nouvelles »)
 *   • clé connue, empreinte différente   → UPDATE des champs modifiables (« modifiées »)
 *                                          SEULEMENT si la ligne du fichier est plus récente (« plus_anciennes » sinon)
 *   • clé connue, empreinte identique    → rien, updated_at intact      (« inchangées »)
 * Les lignes présentes en base mais absentes du fichier ne sont JAMAIS supprimées (historique).
 *
 * « Plus récente » : DATE_UPDATE la plus récente l'emporte. Si elle ne tranche pas (égale ou vide des deux côtés),
 * c'est la dernière date du fichier qui compte : un fichier arrêté au 12 n'écrase pas une ligne venue d'un fichier arrêté au 18.
 * Ce second cas n'est tranché qu'en fin de lecture, quand la dernière date du fichier est connue.
 */
class CeltiisImporter
{
    /** @var array<string, int> */
    private array $compteurs = [];

    /** @var array<int, array<string, mixed>> */
    private array $rejets = [];

    private ?string $min = null;

    private ?string $max = null;

    /** @var array<string, array{0: array<string, mixed>, 1: ?string}> clé → [ligne, « au » du fichier qui l'a écrite en base] */
    private array $enAttente = [];

    /** @return array<string, mixed> */
    public function importer(string $chemin, string $nomOriginal, string $hashFichier, bool $forcer = false): array
    {
        if (! $forcer) {
            $deja = Import::dejaImporte('souscriptions', $hashFichier);
            if ($deja) {
                return ['statut' => 'deja_importe', 'message' => 'Ce fichier exact a déjà été importé le '.date('d/m/Y à H:i', (int) strtotime($deja['created_at'])).' : rien à faire.', 'stats' => $deja['stats']];
            }
        }

        Import::marquerInterrompus('souscriptions', 15);
        $importId = Import::creer(['type' => 'souscriptions', 'nom_fichier' => $nomOriginal, 'file_hash' => $hashFichier, 'statut' => 'en_cours']);
        $termine = false;
        register_shutdown_function(static function () use ($importId, &$termine) {
            if (! $termine) {
                self::signalerArretBrutal($importId);
            }
        });

        try {
            $stats = Db::transaction(fn () => $this->traiter($chemin, $importId));
        } catch (Throwable $e) {
            $termine = true;
            Import::modifier($importId, ['statut' => 'echec', 'erreur' => mb_substr($e->getMessage(), 0, 2000)]);
            throw $e;
        }
        $termine = true;

        if ($stats['lignes_valides'] === 0) {
            Import::modifier($importId, ['statut' => 'echec', 'erreur' => 'Aucune ligne exploitable', 'stats' => $stats]);

            return ['statut' => 'vide', 'message' => 'Aucune ligne exploitable dans le fichier.', 'stats' => $stats];
        }

        Import::modifier($importId, ['statut' => 'ok', 'stats' => $stats, 'mois' => substr($stats['au'], 0, 7)]);
        Cache::invalider();   // nouvelles ventes : résultats des commerciaux à recalculer

        return ['statut' => 'importe', 'import_id' => $importId, 'stats' => $stats];
    }

    /**
     * Parcourt EXPLICITEMENT CHAQUE feuille du classeur. Une feuille est importée si elle contient l'en-tête Celtiis
     * (colonnes obligatoires) ; les autres (TCD, synthèses, onglet « obj »…) sont ignorées et listées dans les stats.
     * Le dédoublonnage ($vus) est commun à toutes les feuilles : une même souscription présente dans deux onglets
     * n'est comptée et écrite qu'une fois.
     *
     * @return array<string, mixed>
     */
    private function traiter(string $chemin, int $importId): array
    {
        $this->compteurs = ['lues' => 0, 'vides' => 0, 'nouvelles' => 0, 'modifiees' => 0, 'inchangees' => 0, 'doublons' => 0, 'valides' => 0, 'rejetees' => 0, 'plus_anciennes' => 0];
        $this->rejets = [];
        $this->enAttente = [];
        $this->min = $this->max = null;
        $vus = [];   // clé → préfixe d'empreinte déjà écrit pendant CET import (détection des doublons internes)
        $feuilles = [];

        foreach (ExcelReader::feuilles($chemin) as $nomFeuille) {
            $mapper = new CeltiisRowMapper;
            $validesAvant = $this->compteurs['valides'];
            try {
                $this->traiterFeuille($chemin, $nomFeuille, $mapper, $importId, $vus);
            } catch (InvalidArgumentException $e) {
                if ($mapper->enteteTrouvee()) {
                    throw $e;   // erreur APRÈS le début de l'écriture : la transaction doit être annulée
                }
                $feuilles[] = ['nom' => $nomFeuille, 'statut' => 'ignoree', 'motif' => $e->getMessage()];

                continue;
            }
            $feuilles[] = ['nom' => $nomFeuille, 'statut' => 'importee', 'lignes_valides' => $this->compteurs['valides'] - $validesAvant];
        }

        if (! array_filter($feuilles, fn (array $f) => $f['statut'] === 'importee')) {
            $motifs = array_unique(array_column($feuilles, 'motif'));
            throw new InvalidArgumentException(count($feuilles) > 1
                ? 'Aucune des '.count($feuilles).' feuilles ne contient les données de souscriptions Celtiis. '.implode(' ', $motifs)
                : ($motifs[0] ?? 'Fichier vide ou illisible : aucune ligne d\'en-tête.'));
        }

        $this->resoudreEnAttente($importId);
        $c = $this->compteurs;

        return [
            'lignes_lues' => $c['lues'],
            'lignes_valides' => $c['valides'],
            'nouvelles' => $c['nouvelles'],
            'modifiees' => $c['modifiees'],
            'inchangees' => $c['inchangees'],
            'plus_anciennes' => $c['plus_anciennes'],
            'doublons_fichier' => $c['doublons'],
            'rejetees' => $c['rejetees'],
            'rejets' => $this->rejets,
            'feuilles' => $feuilles,
            'du' => $this->min !== null ? substr($this->min, 0, 10) : null,
            'au' => $this->max !== null ? substr($this->max, 0, 10) : null,
        ];
    }

    /**
     * Une feuille, lue par lots : classement nouvelles / modifiées / inchangées puis upsert du lot.
     * Requêtes SQL par lot : 1 lecture des empreintes existantes + 1 upsert par tranche de celtiis.chunk lignes (pas de N+1).
     *
     * @param  array<string, string>  $vus
     */
    private function traiterFeuille(string $chemin, string $nomFeuille, CeltiisRowMapper $mapper, int $importId, array &$vus): void
    {
        foreach (ExcelReader::lots($chemin, (int) Config::get('uploads.lot_lignes', 5000), $nomFeuille) as $debut => $rows) {
            $lot = $mapper->lot($rows, $debut);
            unset($rows);

            $this->compteurs['lues'] += $lot['lues'];
            $this->compteurs['vides'] += $lot['vides'];
            $this->compteurs['rejetees'] += count($lot['rejets']);
            foreach ($lot['rejets'] as $r) {
                if (count($this->rejets) < 20) {
                    $this->rejets[] = ['feuille' => $nomFeuille] + $r;
                }
            }

            // Doublons : même clé deux fois (dans le lot, un lot précédent ou une autre feuille) → la dernière occurrence l'emporte
            $parCle = [];
            foreach ($lot['lignes'] as $l) {
                $k = CeltiisRowMapper::cle($l['date_commande'], $l['id_client'], $l['msisdn']);
                if (isset($parCle[$k]) || isset($vus[$k])) {
                    $this->compteurs['doublons']++;
                }
                $parCle[$k] = $l;
            }
            unset($lot);
            if (! $parCle) {
                continue;
            }
            $this->compteurs['valides'] += count($parCle);

            $dates = array_column($parCle, 'date_commande');
            $lotMin = min($dates);
            $lotMax = max($dates);
            $this->min = $this->min === null || $lotMin < $this->min ? $lotMin : $this->min;
            $this->max = $this->max === null || $lotMax > $this->max ? $lotMax : $this->max;

            // Empreintes déjà en base pour les clients du lot (une requête, 4 colonnes). Filtrer sur id_client en plus
            // de la plage de dates évite de relire toute la table quand le fichier n'est pas trié par date.
            $existantes = CeltiisData::empreintes($lotMin, $lotMax, array_values(array_unique(array_column($parCle, 'id_client'))));

            $aEcrire = [];
            foreach ($parCle as $k => $l) {
                if (isset($vus[$k])) {
                    // Doublon interne déjà écrit plus tôt : on ne réécrit que si le contenu diffère
                    if ($vus[$k] !== substr($l['row_hash'], 0, 16)) {
                        $aEcrire[] = $l;
                    }
                } elseif (! array_key_exists($k, $existantes)) {
                    $this->compteurs['nouvelles']++;
                    $aEcrire[] = $l;
                } elseif ($existantes[$k]['hash'] !== $l['row_hash']) {
                    $recente = self::plusRecente($l, $existantes[$k]);
                    if ($recente === null) {
                        $this->enAttente[$k] = [$l, $existantes[$k]['au']];
                    } elseif ($recente) {
                        $this->compteurs['modifiees']++;
                        $aEcrire[] = $l;
                    } else {
                        $this->compteurs['plus_anciennes']++;
                    }
                } else {
                    $this->compteurs['inchangees']++;
                }
                $vus[$k] = substr($l['row_hash'], 0, 16);
            }
            unset($existantes, $parCle);

            // Upsert : filet de sécurité SQL contre toute course entre deux imports simultanés
            CeltiisData::upsertLots($aEcrire, $importId);
            unset($aEcrire);
        }

        if (! $mapper->enteteTrouvee()) {
            throw new InvalidArgumentException("Feuille « $nomFeuille » vide : aucune ligne d'en-tête.");
        }
    }

    /**
     * La ligne du fichier est-elle plus récente que celle en base, d'après DATE_UPDATE ?
     * null : DATE_UPDATE ne permet pas de trancher (égale, ou vide des deux côtés).
     *
     * @param  array<string, mixed>  $ligne
     * @param  array{date_update: ?string}  $existante
     */
    private static function plusRecente(array $ligne, array $existante): ?bool
    {
        $fichier = $ligne['date_update'];
        $base = $existante['date_update'];
        if ($fichier !== null && $base !== null && $fichier !== $base) {
            return $fichier > $base;
        }
        if (($fichier === null) !== ($base === null)) {
            return $fichier !== null;   // seule la base a une DATE_UPDATE → le fichier est plus ancien, et inversement
        }

        return null;
    }

    /** Lignes en attente : écrites si le fichier va au moins aussi loin que celui qui les a écrites en base. */
    private function resoudreEnAttente(int $importId): void
    {
        $au = $this->max !== null ? substr($this->max, 0, 10) : null;
        $aEcrire = [];
        foreach ($this->enAttente as [$ligne, $auBase]) {
            if ($auBase === null || ($au !== null && $au >= $auBase)) {
                $this->compteurs['modifiees']++;
                $aEcrire[] = $ligne;
            } else {
                $this->compteurs['plus_anciennes']++;
            }
        }
        $this->enAttente = [];
        CeltiisData::upsertLots($aEcrire, $importId);
    }

    /**
     * Erreur fatale PHP pendant l'import (mémoire, durée) : aucune exception n'est levée, l'import resterait « en_cours ».
     * On annule la transaction, on passe l'import en échec avec la cause, et on l'écrit dans storage/logs/app.log.
     */
    private static function signalerArretBrutal(int $importId): void
    {
        $limite = ini_get('memory_limit');
        @ini_set('memory_limit', '-1');   // un peu de marge pour écrire l'échec après un dépassement de mémoire
        $err = error_get_last();
        $texte = (string) ($err['message'] ?? '');
        $cause = match (true) {
            str_contains($texte, 'Allowed memory size') => 'Mémoire PHP insuffisante (memory_limit = '.$limite.' réellement accordé par l\'hébergeur).',
            str_contains($texte, 'Maximum execution time') => 'Durée maximale dépassée (max_execution_time = '.ini_get('max_execution_time').' s).',
            $texte !== '' => 'Import interrompu : '.$texte,
            default => 'Import interrompu avant la fin (connexion coupée ou arrêt du serveur).',
        };
        try {
            if (Db::pdo()->inTransaction()) {
                Db::pdo()->rollBack();
            }
            Import::modifier($importId, ['statut' => 'echec', 'erreur' => $cause.' Aucune ligne n\'a été enregistrée.']);
            Journal::avertissement('Import souscriptions n°'.$importId.' : '.$cause);
        } catch (Throwable) {
            // base injoignable : Import::marquerInterrompus() rattrapera cet import au prochain envoi
        }
    }
}
