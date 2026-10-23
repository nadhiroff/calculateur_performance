<?php

namespace App\Services;

use App\Support\Nombre;

use App\Config;
use App\Support\ExcelReader;
use App\Support\LoginKey;
use InvalidArgumentException;

/**
 * Lignes brutes → lignes normalisées prêtes pour celtiis_datas.
 * Reproduit la logique de parser.js (depuisAoa) : détection de l'en-tête, colonnes obligatoires, lignes vides, dates invalides.
 *
 * Utilisable PAR LOTS (gros fichiers) : l'en-tête est détecté dans le 1er lot puis mémorisé pour les suivants.
 *   $m = new CeltiisRowMapper();  foreach (ExcelReader::lots(...) as $debut => $rows) { $res = $m->lot($rows, $debut); … }
 */
final class CeltiisRowMapper
{
    /** Champs dont un changement signifie « la ligne a été modifiée chez Celtiis ». */
    private const CHAMPS_HASH = [
        'code', 'type_client', 'client_nom', 'statut', 'nom_offre', 'montant_total', 'agence',
        'login_vendeur', 'nom_vendeur', 'date_provisioning', 'date_update',
    ];

    /**
     * Autres noms rencontrés pour une même colonne (ex. EVOLUTION_*.xlsx : « NOM_CLIENT »).
     * Appliqués seulement si le nom officiel est absent de l'en-tête.
     */
    private const ALIAS = [
        'NOM_CLIENT' => 'PRENOM_NOM/RAISON_SOCIALE',
        'RAISON_SOCIALE' => 'PRENOM_NOM/RAISON_SOCIALE',
    ];

    /** @var string[]|null */
    private ?array $entetes = null;

    /** @var array<string,int>|null */
    private ?array $ix = null;

    private static function nom(mixed $s): string
    {
        return (string) preg_replace('/\s+/', '_', mb_strtoupper(trim((string) ($s ?? ''))));
    }

    public function enteteTrouvee(): bool
    {
        return $this->ix !== null;
    }

    /**
     * Traite un lot de lignes. $premiereLigne = numéro Excel (1-based) de la 1re ligne du lot (pour les messages de rejet).
     *
     * @param  array<int, array<int, mixed>>  $rows
     * @return array{lignes: array<int, array<string, mixed>>, rejets: array<int, array{ligne:int, motif:string}>, lues: int, vides: int}
     */
    public function lot(array $rows, int $premiereLigne = 1): array
    {
        $debutCorps = 0;

        if ($this->ix === null) {
            $this->detecterEntete($rows);
            $debutCorps = $this->indexEntete + 1;
        }

        $colDates = Config::get('celtiis.colonnes_date');
        $ix = $this->ix;
        $entetes = $this->entetes;

        $lignes = [];
        $rejets = [];
        $vides = 0;
        $lues = 0;

        foreach (array_slice($rows, $debutCorps, null, true) as $i => $r) {
            $numLigne = $premiereLigne + $i;
            $lues++;
            if (! is_array($r) || self::vide($r)) {
                $vides++;

                continue;
            }
            $val = static fn (string $col) => isset($ix[$col]) ? ($r[$ix[$col]] ?? null) : null;

            $dateCmd = ExcelReader::date($val('DATE_COMMANDE'));
            if ($dateCmd === null) {
                $rejets[] = ['ligne' => $numLigne, 'motif' => 'DATE_COMMANDE invalide'];

                continue; // sans date, pas de clé : la ligne ne peut pas être dédoublonnée
            }
            $idClient = ExcelReader::texte($val('ID_CLIENT'));
            if ($idClient === '') {
                $rejets[] = ['ligne' => $numLigne, 'motif' => 'ID_CLIENT vide'];

                continue;
            }

            // Ligne brute indexée par nom de colonne ; dates numériques converties en texte lisible
            $raw = [];
            foreach ($entetes as $k => $nomCol) {
                if ($nomCol === '') {
                    continue;
                }
                $v = $r[$k] ?? null;
                if (in_array($nomCol, $colDates, true) && (is_int($v) || is_float($v))) {
                    $v = ExcelReader::date($v) ?? $v;
                } elseif (is_float($v) && floor($v) === $v && abs($v) < 1e15) {
                    $v = (int) $v;
                } elseif (is_string($v)) {
                    $v = trim($v);
                }
                $raw[$nomCol] = $v;
            }

            $login = mb_strtolower(ExcelReader::texte($val('LOGIN_VENDEUR')));
            $ligne = [
                'date_commande' => $dateCmd,
                'id_client' => $idClient,
                'msisdn' => ExcelReader::texte($val('MSISDN')),
                'code' => self::nullable(ExcelReader::texte($val('CODE'))),
                'type_client' => mb_strtoupper(ExcelReader::texte($val('TYPE_CLIENT'))),
                'client_nom' => self::nullable(ExcelReader::texte($val('PRENOM_NOM/RAISON_SOCIALE'))),
                'statut' => mb_strtoupper(ExcelReader::texte($val('STATUS'))),
                'nom_offre' => self::nullable(ExcelReader::texte($val('NOM_OFFRE'))),
                'montant_total' => Nombre::arrondi(ExcelReader::nombre($val('MONTANT_TOTAL')), 2),
                'agence' => self::nullable(ExcelReader::texte($val('AGENCE'))),
                'login_vendeur' => self::nullable($login),
                'login_key' => self::nullable(LoginKey::from($login)),
                'nom_vendeur' => self::nullable(ExcelReader::texte($val('NOM_VENDEUR'))),
                'date_provisioning' => ExcelReader::date($val('DATE_PROVISIONNING')),
                'date_update' => ExcelReader::date($val('DATE_UPDATE')),
                'raw' => $raw,
            ];
            $ligne['row_hash'] = self::empreinte($ligne);
            $lignes[] = $ligne;
        }

        return ['lignes' => $lignes, 'rejets' => $rejets, 'lues' => $lues, 'vides' => $vides];
    }

    /**
     * Lecture en une fois (petits fichiers / tests). Conserve l'ancienne API.
     *
     * @param  array<int, array<int, mixed>>  $aoa
     * @return array{entetes: string[], lignes: array<int, array<string, mixed>>, rejets: array<int, array{ligne:int, motif:string}>, lues: int, vides: int}
     */
    public function mapper(array $aoa): array
    {
        $this->ix = null;
        $this->entetes = null;
        $res = $this->lot($aoa, 1);

        return ['entetes' => $this->entetes] + $res;
    }

    private int $indexEntete = 0;

    /** @param array<int, array<int, mixed>> $rows */
    private function detecterEntete(array $rows): void
    {
        $oblig = Config::get('celtiis.obligatoires');

        foreach ($rows as $i => $r) {
            if (! is_array($r)) {
                continue;
            }
            $noms = array_map([self::class, 'nom'], $r);
            if (count(array_intersect($oblig, $noms)) >= 3) {
                $manquantes = array_values(array_diff($oblig, $noms));
                if ($manquantes) {
                    throw new InvalidArgumentException('Colonnes manquantes : '.implode(', ', $manquantes).'.');
                }
                foreach (self::ALIAS as $alias => $officiel) {
                    $k = array_search($alias, $noms, true);
                    if ($k !== false && ! in_array($officiel, $noms, true)) {
                        $noms[$k] = $officiel;
                    }
                }
                $this->entetes = $noms;
                $this->ix = array_flip($noms); // nom normalisé → index (dernière occurrence)
                $this->indexEntete = $i;

                return;
            }
        }

        throw new InvalidArgumentException('En-têtes introuvables. Colonnes attendues : '.implode(', ', $oblig).'.');
    }

    /** SHA-256 des champs modifiables, dans un ordre fixe, montant formaté à 2 décimales (stable entre deux imports). */
    public static function empreinte(array $ligne): string
    {
        $payload = [];
        foreach (self::CHAMPS_HASH as $c) {
            $v = $ligne[$c] ?? null;
            $payload[] = $c === 'montant_total' ? number_format((float) $v, 2, '.', '') : $v;
        }

        return hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    /** Clé de déduplication « date|id_client|msisdn » (même formule pour le fichier et pour la base). */
    public static function cle(string $dateCommande, string $idClient, string $msisdn): string
    {
        return $dateCommande.'|'.$idClient.'|'.$msisdn;
    }

    private static function vide(array $r): bool
    {
        foreach ($r as $c) {
            if ($c !== null && trim((string) $c) !== '') {
                return false;
            }
        }

        return true;
    }

    private static function nullable(string $s): ?string
    {
        return $s === '' ? null : $s;
    }
}
