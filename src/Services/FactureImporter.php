<?php

namespace App\Services;

use App\Db;
use App\Models\Import;
use App\Support\ExcelReader;
use App\Support\LoginKey;
use App\Support\Texte;
use InvalidArgumentException;
use PhpOffice\PhpSpreadsheet\IOFactory;
use Throwable;

/**
 * Import des fichiers « POINT VENTES FTTH … » reçus chaque fin de mois (base de la facture Celtiis).
 *
 * Le format change d'un mois à l'autre (noms et ordre des feuilles, nombre et ordre des colonnes) : rien n'est lu par position.
 *   1. Feuilles retenues, d'après leur NOM : « liste … client(s) » → source « clients » ; « … arriéré(s) … » → source « arrieres ».
 *      Les autres feuilles (rapprochement, point des ventes, commissionnement, liste des paiements, facture à faire…) sont ignorées.
 *      Filet : si aucun nom ne correspond, toute feuille dont les colonnes contiennent LOGIN + DEBIT + PAIEMENT est prise comme liste des clients.
 *   2. Ligne d'en-tête cherchée dans les 15 premières lignes ; chaque champ est trouvé par le TITRE de sa colonne
 *      (plusieurs titres possibles, ex. « LOGIN » / « LOG IN » / « LOGIN_VENDEUR »), et pour chaque ligne la première valeur non vide est prise.
 *   3. Nature de chaque LIGNE (les arriérés peuvent être mélangés dans la liste des clients, comme en août 2026) :
 *        « Arriérés à payer … » (colonne PAIEMENT ou PERIODE) ou ligne d'une feuille d'arriérés → REPORT_PAYE (facturé, ligne à part) ;
 *        « A PAYER » → PAYE (facturé) ; « PAIEMENT REPORTE » → REPORTE ; le reste (« VENTE NON VALIDEE »…) → NON_VALIDE.
 *   4. Mois facturé : mois le plus fréquent des DATE_COMMANDE de la liste des clients, sinon le mois écrit dans le nom du fichier.
 *   5. Enregistrement en une transaction : les lignes du même mois et des mêmes types de feuilles sont remplacées (pas de doublon).
 */
final class FactureImporter
{
    private const MOIS_FR = ['JANVIER' => 1, 'FEVRIER' => 2, 'MARS' => 3, 'AVRIL' => 4, 'MAI' => 5, 'JUIN' => 6, 'JUILLET' => 7,
        'AOUT' => 8, 'SEPTEMBRE' => 9, 'OCTOBRE' => 10, 'NOVEMBRE' => 11, 'DECEMBRE' => 12];

    /** Champ → titres de colonne possibles (normalisés : majuscules sans accent, lettres et chiffres seulement), par ordre de préférence. */
    private const CHAMPS = [
        'login' => ['LOGIN', 'LOGIN2', 'LOGINVENDEUR'],
        'partenaire' => ['PARTENAIRE', 'PARTENER'],
        'facture' => ['FACTURE', 'FACTURE2'],
        'ref_paiement' => ['REFCCASH', 'REFECCASH', 'REFERENCESPAIEMENT'],
        'numero' => ['NUMERO', 'MSISDN'],
        'montant' => ['MONTANT', 'MONTANTTOTAL'],
        'paiement' => ['PAIEMENT', 'OBSERVATION'],
        'periode' => ['PERIODE', 'TYPEVENTE'],
        'statut' => ['STATUS', 'STATUT'],
        'type_client' => ['TYPECLIENT'],
        'client' => ['PRENOMNOMRAISONSOCIALE', 'RAISONSOCIALE', 'NOMCLIENT'],
        'debit' => ['DEBIT'],
        'offre' => ['NOMOFFRE'],
        'date_commande' => ['DATECOMMANDE', 'DATE', 'DATEPROVISIONNING', 'DATEFINMSISDN'],
        'date_update' => ['DATEUPDATE'],
        'motif' => ['MOTIFNONPAIEMENT', 'REJETVENTES', 'MOTIF'],
    ];

    /**
     * Lit le fichier SANS rien écrire.
     *
     * @return array{mois: ?string, lignes: array<int, array<string, mixed>>, feuilles: array<int, array<string, mixed>>, avertissements: string[]}
     */
    public function lire(string $chemin, string $nomFichier): array
    {
        $noms = ExcelReader::feuilles($chemin);
        $retenues = [];
        foreach ($noms as $nom) {
            $source = self::sourceDuNom($nom);
            if ($source !== null) {
                $retenues[$nom] = $source;
            }
        }
        // « LISTE CLIENTS COPIE » à côté de « LISTE CLIENTS » : la copie est ignorée (sinon chaque vente serait comptée deux fois)
        foreach ($retenues as $nom => $source) {
            if (preg_match('/\bCOP(IE|Y)\b/', strtoupper(Texte::ascii($nom))) && count(array_filter($retenues, static fn ($s, $n) => $s === $source && $n !== $nom && ! preg_match('/\bCOP(IE|Y)\b/', strtoupper(Texte::ascii($n))), ARRAY_FILTER_USE_BOTH))) {
                unset($retenues[$nom]);
            }
        }
        $filet = ! $retenues;   // aucun nom reconnu (ex. fichier B2B, feuille « REAL ») : on examine les colonnes de toutes les feuilles

        $reader = IOFactory::createReaderForFile($chemin);
        if (method_exists($reader, 'setReadDataOnly')) {
            $reader->setReadDataOnly(true);
        }
        if (! $filet && method_exists($reader, 'setLoadSheetsOnly')) {
            $reader->setLoadSheetsOnly(array_keys($retenues));
        }
        $classeur = $reader->load($chemin);

        $lignes = [];
        $feuilles = [];
        $avertissements = [];
        foreach ($classeur->getWorksheetIterator() as $ws) {
            $nom = $ws->getTitle();
            $source = $retenues[$nom] ?? ($filet ? 'clients' : null);
            if ($source === null) {
                continue;
            }
            // valeurs en cache des formules (comme ExcelReader::aoa)
            $aoa = $ws->toArray(null, false, false, false, false, false, false, true);
            [$iEntete, $cols] = self::entete($aoa);
            if ($iEntete === null) {
                if (! $filet) {
                    $avertissements[] = 'Feuille « '.$nom.' » ignorée : colonnes LOGIN et DEBIT introuvables.';
                }
                continue;
            }
            if ($filet && ! isset($cols['paiement'])) {
                continue;   // en mode filet, seule une vraie liste (avec PAIEMENT ou OBSERVATION) est retenue
            }
            $n = 0;
            for ($i = $iEntete + 1, $max = count($aoa); $i < $max; $i++) {
                $l = self::ligne($aoa[$i], $cols, $source);
                if ($l === null) {
                    continue;
                }
                $l += ['source' => $source, 'feuille' => mb_substr($nom, 0, 100), 'ligne' => $i + 1, 'fichier' => mb_substr($nomFichier, 0, 255),
                    'donnees' => self::donnees($aoa[$iEntete], $aoa[$i])];
                $lignes[] = $l;
                $n++;
            }
            $feuilles[] = ['nom' => $nom, 'source' => $source, 'lignes' => $n, 'entete' => $iEntete + 1];
        }
        $classeur->disconnectWorksheets();

        $ignorees = array_values(array_diff($noms, array_column($feuilles, 'nom')));
        $mois = self::moisFacture($lignes, $nomFichier, $avertissements);

        // Vente d'un autre mois payée ce mois-ci (« TYPE_VENTE = Vente Juillet » dans le fichier de septembre) : arriéré facturé à part
        foreach ($lignes as &$l) {
            $mv = self::moisDeVente((string) $l['periode']);
            if ($mois !== null && $mv !== null && $mv !== (int) substr($mois, 5, 2) && $l['etat'] === 'PAYE') {
                $l['liste'] = 'arrieres';
                $l['etat'] = 'REPORT_PAYE';
            }
        }
        unset($l);
        // Fichier B2B envoyé à part (aucune offre FTTH Home) : ses lignes ne remplacent que le B2B du mois, jamais la liste B2C
        if ($lignes && ! array_filter($lignes, static fn ($l) => $l['debit'] === null || str_starts_with((string) $l['debit'], 'FTTH_HOME_'))) {
            foreach ($lignes as &$l) {
                $l['source'] = 'b2b';
            }
            unset($l);
            foreach ($feuilles as &$f) {
                $f['source'] = 'b2b';
            }
            unset($f);
        }

        return ['mois' => $mois, 'lignes' => $lignes, 'feuilles' => $feuilles, 'ignorees' => $ignorees, 'avertissements' => $avertissements];
    }

    /**
     * Lit puis enregistre. $mois (AAAA-MM) facultatif : impose le mois facturé.
     *
     * @return array<string, mixed>
     */
    public function importer(string $chemin, string $nomFichier, ?string $mois = null): array
    {
        $lu = $this->lire($chemin, $nomFichier);
        if (! $lu['lignes']) {
            throw new InvalidArgumentException('Aucune liste de clients ni d\'arriérés trouvée dans « '.$nomFichier.' ». Feuilles du fichier : '
                .implode(', ', $lu['ignorees']).'. Il faut une feuille nommée « Liste des clients » (ou « Liste clients ») ou « Liste des arriérés », avec les colonnes LOGIN, DEBIT et PAIEMENT.');
        }
        $mois ??= $lu['mois'];
        if ($mois === null) {
            throw new InvalidArgumentException('Mois de la facture introuvable : ni les dates de commande ni le nom du fichier « '.$nomFichier.' » ne l\'indiquent. Ajoutez le mois au nom du fichier (ex. « POINT VENTES FTTH RGZ SEPTEMBRE 2026.xlsx »).');
        }

        $sources = array_values(array_unique(array_column($lu['lignes'], 'source')));
        $importId = Import::creer(['type' => 'factures', 'nom_fichier' => mb_substr($nomFichier, 0, 255), 'file_hash' => hash_file('sha256', $chemin), 'statut' => 'en_cours', 'mois' => $mois]);

        try {
            $stats = Db::transaction(function () use ($lu, $mois, $sources, $importId) {
                $supprimees = Db::executer('DELETE FROM `factures_lignes` WHERE `mois` = ? AND `source` IN ('.Db::marques(count($sources)).')', array_merge([$mois], $sources));
                $maintenant = Db::maintenant();
                foreach (array_chunk($lu['lignes'], 300) as $lot) {
                    $valeurs = array_map(static function (array $l) use ($mois, $importId, $maintenant) {
                        unset($l['periode']);

                        return ['mois' => $mois, 'import_id' => $importId] + $l + ['created_at' => $maintenant, 'updated_at' => $maintenant];
                    }, $lot);
                    Db::upsert('factures_lignes', $valeurs, ['updated_at']);
                }

                return self::stats($lu, $mois, $supprimees);
            });
        } catch (Throwable $e) {
            Import::modifier($importId, ['statut' => 'echec', 'erreur' => mb_substr($e->getMessage(), 0, 2000)]);
            throw $e;
        }
        Import::modifier($importId, ['statut' => 'ok', 'stats' => $stats]);

        return ['statut' => 'importe', 'message' => self::message($stats, $nomFichier), 'stats' => $stats];
    }

    /** Type de feuille d'après son nom, ou null si elle ne nous intéresse pas. */
    public static function sourceDuNom(string $nom): ?string
    {
        $n = strtoupper(Texte::ascii($nom));
        if (str_contains($n, 'ARRIER')) {
            return 'arrieres';
        }
        if (str_contains($n, 'LIST') && str_contains($n, 'CLIENT')) {
            return 'clients';
        }

        return null;
    }

    private static function cle(mixed $titre): string
    {
        return (string) preg_replace('/[^A-Z0-9]/', '', strtoupper(Texte::ascii(ExcelReader::texte($titre))));
    }

    /**
     * Ligne d'en-tête (index 0-based) et, pour chaque champ, la liste des colonnes candidates (dans l'ordre de préférence).
     *
     * @param  array<int, array<int, mixed>>  $aoa
     * @return array{0: ?int, 1: array<string, int[]>}
     */
    private static function entete(array $aoa): array
    {
        foreach (array_slice($aoa, 0, 15, true) as $i => $row) {
            $index = [];
            foreach ($row as $c => $titre) {
                $k = self::cle($titre);
                if ($k !== '' && ! isset($index[$k])) {
                    $index[$k] = $c;
                }
            }
            $cols = [];
            foreach (self::CHAMPS as $champ => $titres) {
                foreach ($titres as $t) {
                    if (isset($index[$t])) {
                        $cols[$champ][] = $index[$t];
                    }
                }
            }
            if (isset($cols['login'], $cols['debit'])) {
                return [$i, $cols];
            }
        }

        return [null, []];
    }

    /** Valeur « vide » des fichiers Excel : cellule vide, #N/A, #REF!… */
    private static function propre(mixed $v): string
    {
        $s = ExcelReader::texte($v);

        return preg_match('/^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!)$/i', $s) ? '' : $s;
    }

    /**
     * @param  array<int, mixed>  $row
     * @param  array<string, int[]>  $cols
     * @return array<string, mixed>|null
     */
    private static function ligne(array $row, array $cols, string $source): ?array
    {
        $v = static function (string $champ) use ($row, $cols): string {
            foreach ($cols[$champ] ?? [] as $c) {
                $x = self::propre($row[$c] ?? null);
                if ($x !== '') {
                    return $x;
                }
            }

            return '';
        };
        $date = static function (string $champ) use ($row, $cols): ?string {
            foreach ($cols[$champ] ?? [] as $c) {
                $d = ExcelReader::date($row[$c] ?? null);
                if ($d !== null) {
                    return $d;
                }
            }

            return null;
        };

        $login = $v('login');
        $facture = $v('facture');
        $debit = $v('debit');
        $paiement = $v('paiement');
        // Ligne vide, de total ou de titre : ni login ni facture, ou login qui n'en est pas un (« Total … », « PVT RGZ »)
        if (($login === '' && $facture === '') || ($login !== '' && ! preg_match('/[_.\-]/', $login))) {
            return null;
        }
        $periode = $v('periode');
        [$liste, $etat] = self::etat($paiement, $periode, $source);
        $montant = $v('montant');

        return [
            'liste' => $liste, 'etat' => $etat, 'periode' => $periode,
            'login' => mb_substr($login, 0, 120) ?: null, 'login_key' => $login !== '' ? mb_substr(LoginKey::from($login), 0, 120) : null,
            'partenaire' => mb_substr($v('partenaire'), 0, 60) ?: null, 'facture' => mb_substr($facture, 0, 40) ?: null,
            'ref_paiement' => mb_substr($v('ref_paiement'), 0, 40) ?: null, 'numero' => mb_substr($v('numero'), 0, 30) ?: null,
            'montant' => $montant !== '' && is_numeric(str_replace([' ', ','], ['', '.'], $montant)) ? ExcelReader::nombre($montant) : null,
            'paiement' => mb_substr($paiement, 0, 80) ?: null, 'statut' => mb_substr($v('statut'), 0, 30) ?: null,
            'type_client' => mb_substr($v('type_client'), 0, 40) ?: null, 'client' => mb_substr($v('client'), 0, 190) ?: null,
            'debit' => $debit !== '' ? mb_substr(strtoupper((string) preg_replace('/\s+/', '_', $debit)), 0, 40) : null,
            'offre' => mb_substr($v('offre'), 0, 120) ?: null,
            'date_commande' => $date('date_commande'), 'date_update' => $date('date_update'),
            'motif' => mb_substr($v('motif'), 0, 190) ?: null,
        ];
    }

    /**
     * Nature de la ligne et état de paiement.
     *
     * @return array{0: string, 1: string} [liste, etat]
     */
    public static function etat(string $paiement, string $periode, string $source): array
    {
        $p = strtoupper(Texte::ascii($paiement));
        $arriere = $source === 'arrieres' || str_contains($p, 'ARRIER') || str_contains(strtoupper(Texte::ascii($periode)), 'ARRIER');
        if ($arriere) {
            // Feuille / ligne d'arriérés : à payer, sauf mention contraire explicite
            if (str_contains($p, 'NON VALIDE')) {
                return ['arrieres', 'NON_VALIDE'];
            }
            if (str_contains($p, 'REPORT') && ! str_contains($p, 'ARRIER') && ! preg_match('/REPORT.*PAYE/', $p)) {
                return ['arrieres', 'REPORTE'];
            }

            return ['arrieres', 'REPORT_PAYE'];
        }
        if (preg_match('/^A PAYER$/', trim($p))) {
            return ['clients', 'PAYE'];
        }
        if (preg_match('/REPORT.*PAYE/', $p)) {
            return ['clients', 'REPORT_PAYE'];
        }
        if (str_contains($p, 'REPORT')) {
            return ['clients', 'REPORTE'];
        }

        return ['clients', 'NON_VALIDE'];
    }

    /**
     * Toutes les colonnes de la ligne, avec leur titre (cellules vides omises).
     *
     * @param  array<int, mixed>  $entete
     * @param  array<int, mixed>  $row
     */
    private static function donnees(array $entete, array $row): string
    {
        $o = [];
        foreach ($row as $c => $val) {
            if ($val === null || $val === '') {
                continue;
            }
            $titre = ExcelReader::texte($entete[$c] ?? '') ?: 'COL'.($c + 1);
            while (isset($o[$titre])) {
                $titre .= '_';
            }
            $o[$titre] = is_float($val) || is_int($val) ? $val : ExcelReader::texte($val);
        }

        return (string) json_encode($o, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    /**
     * Mois facturé : mois le plus fréquent des dates de commande de la liste des clients ; sinon celui du nom du fichier.
     *
     * @param  array<int, array<string, mixed>>  $lignes
     * @param  string[]  $avertissements
     */
    private static function moisFacture(array $lignes, string $nomFichier, array &$avertissements): ?string
    {
        $f = [];
        foreach ($lignes as $l) {
            if ($l['liste'] === 'clients' && $l['date_commande']) {
                $m = substr($l['date_commande'], 0, 7);
                $f[$m] = ($f[$m] ?? 0) + 1;
            }
        }
        arsort($f);
        $donnees = $f ? (string) array_key_first($f) : null;
        $nom = self::moisDuNom($nomFichier);
        if ($donnees !== null && $nom !== null && $donnees !== $nom) {
            $avertissements[] = 'Le nom du fichier indique '.$nom.' mais les ventes sont de '.$donnees.' : la facture est rangée en '.$donnees.'.';
        }

        return $donnees ?? $nom;
    }

    /** Mois d'une mention « Vente Sept », « Vente d'Août 2026 », « Vente Juillet » (1-12) ; null si le texte n'est pas une vente d'un mois. */
    public static function moisDeVente(string $texte): ?int
    {
        $t = strtoupper(Texte::ascii($texte));
        if (! preg_match('/^\s*VENTES?\b/', $t)) {
            return null;
        }
        $abr = ['JANV' => 1, 'FEV' => 2, 'MARS' => 3, 'AVR' => 4, 'MAI' => 5, 'JUIN' => 6, 'JUIL' => 7, 'AOUT' => 8, 'SEPT' => 9, 'OCT' => 10, 'NOV' => 11, 'DEC' => 12];
        foreach ($abr as $a => $n) {
            if (preg_match('/\b'.$a.'/', $t)) {
                return $n;
            }
        }

        return null;
    }

    /** « POINT VENTES FTTH RGZ SEPTEMBRE 2026.xlsx » → « 2026-09 » ; null si absent. */
    public static function moisDuNom(string $nom): ?string
    {
        $n = strtoupper(Texte::ascii($nom));
        foreach (self::MOIS_FR as $mot => $num) {
            if (preg_match('/\b'.$mot.'\b\D{0,3}(20\d{2})/', $n, $m)) {
                return sprintf('%s-%02d', $m[1], $num);
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $lu
     * @return array<string, mixed>
     */
    private static function stats(array $lu, string $mois, int $supprimees): array
    {
        $etats = ['PAYE' => 0, 'REPORT_PAYE' => 0, 'REPORTE' => 0, 'NON_VALIDE' => 0];
        $debits = [];
        $logins = [];
        foreach ($lu['lignes'] as $l) {
            $etats[$l['etat']]++;
            if ($l['etat'] === 'PAYE' || $l['etat'] === 'REPORT_PAYE') {
                $d = $l['debit'] ?? '(sans débit)';
                $debits[$d] = ($debits[$d] ?? 0) + 1;
                if ($l['login_key']) {
                    $logins[$l['login_key']] = true;
                }
            }
        }
        ksort($debits);

        return ['mois' => $mois, 'lignes' => count($lu['lignes']), 'a_payer' => $etats['PAYE'], 'arrieres' => $etats['REPORT_PAYE'],
            'reportees' => $etats['REPORTE'], 'non_validees' => $etats['NON_VALIDE'], 'facturees' => $etats['PAYE'] + $etats['REPORT_PAYE'],
            'par_debit' => $debits, 'logins' => count($logins), 'feuilles' => $lu['feuilles'], 'feuilles_ignorees' => $lu['ignorees'],
            'remplacees' => $supprimees, 'avertissements' => $lu['avertissements']];
    }

    /** @param array<string, mixed> $s */
    private static function message(array $s, string $nomFichier): string
    {
        $f = array_map(static fn ($x) => '« '.$x['nom'].' » ('.$x['lignes'].' lignes)', $s['feuilles']);

        return '« '.$nomFichier.' » : '.implode(' + ', $f).' enregistrées pour '.$s['mois'].'. Facturées : '.$s['facturees'].' ('.$s['a_payer'].' à payer'
            .($s['arrieres'] ? ' + '.$s['arrieres'].' arriéré(s)' : '').'), '.$s['reportees'].' paiement(s) reporté(s), '.$s['non_validees'].' non validée(s).'
            .($s['remplacees'] ? ' L\'ancien import de ce mois a été remplacé.' : '');
    }
}
