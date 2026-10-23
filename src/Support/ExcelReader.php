<?php

namespace App\Support;

use DateTimeInterface;
use Generator;
use InvalidArgumentException;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Reader\Csv;
use PhpOffice\PhpSpreadsheet\Reader\IReadFilter;
use PhpOffice\PhpSpreadsheet\Shared\Date as XlDate;
use ZipArchive;

/**
 * Lecture des fichiers Excel/CSV (.xls, .xlsx, .csv) en « tableau de tableaux » (comme sheet_to_json({header:1}) de SheetJS)
 * + parsing des dates (mêmes formats acceptés que lireDate() de parser.js).
 *
 * CORRECTIF « Aucun objectif reconnu » : le fichier d'objectifs est presque entièrement fait de FORMULES
 * (=D8/5, =SUM(F8:G8)…). PhpSpreadsheet renvoyait le TEXTE de la formule ("=D8/5") au lieu de sa valeur ; le parseur
 * ne voyait donc aucun nombre et rejetait chaque équipe. SheetJS (ancien import navigateur) lisait, lui, la valeur
 * mise en cache par Excel. On fait désormais pareil : valeur en cache, et recalcul seulement si le cache est vide.
 *
 * Prérequis : composer require phpoffice/phpspreadsheet
 */
final class ExcelReader
{
    /**
     * Lecture COMPLÈTE d'une feuille (fichiers modestes : objectifs).
     * Pour les gros fichiers (souscriptions Celtiis) utiliser lots() qui borne la mémoire.
     *
     * @return array<int, array<int, mixed>>
     */
    public static function aoa(string $path, ?string $feuillePreferee = null): array
    {
        $reader = IOFactory::createReaderForFile($path);
        if (method_exists($reader, 'setReadDataOnly')) {
            $reader->setReadDataOnly(true);
        }
        $classeur = $reader->load($path);

        $feuille = null;
        if ($feuillePreferee) {
            foreach ($classeur->getSheetNames() as $nom) {
                if (preg_match($feuillePreferee, $nom)) {
                    $feuille = $classeur->getSheetByName($nom);
                    break;
                }
            }
        }
        $feuille ??= $classeur->getSheet(0);

        // nullValue, calculateFormulas=false, formatData=false, returnCellRef=false, ignoreHidden=false,
        // reduceArrays=false, lessFloatPrecision=false, oldCalculatedValue=TRUE  → valeur en cache des formules
        $aoa = $feuille->toArray(null, false, false, false, false, false, false, true);

        // Filet de sécurité : formule sans valeur en cache (fichier produit par un script) → on la calcule
        foreach ($feuille->getCoordinates() as $coord) {
            $cell = $feuille->getCell($coord);
            if (! $cell->isFormula()) {
                continue;
            }
            [$col, $ligne] = Coordinate::coordinateFromString($coord);
            $r = $ligne - 1;
            $c = Coordinate::columnIndexFromString($col) - 1;
            if (($aoa[$r][$c] ?? null) === null) {
                try {
                    $aoa[$r][$c] = $cell->getCalculatedValue();
                } catch (\Throwable) {
                    $aoa[$r][$c] = null;
                }
            }
        }
        $classeur->disconnectWorksheets();

        return $aoa;
    }

    /**
     * Noms de TOUTES les feuilles du classeur, dans l'ordre des onglets (une seule pour un CSV).
     *
     * @return array<int, string>
     */
    public static function feuilles(string $path): array
    {
        if (self::estXlsx($path)) {
            return array_column(XlsxStreamReader::feuilles($path), 'nom');
        }

        $reader = IOFactory::createReaderForFile($path);
        if ($reader instanceof Csv) {
            return [pathinfo($path, PATHINFO_FILENAME)];
        }

        return array_column($reader->listWorksheetInfo($path), 'worksheetName');
    }

    /**
     * Lecture PAR LOTS d'une feuille ($feuille = son nom ; null = la première).
     *   • .xlsx : lecture en flux (XlsxStreamReader), le fichier n'est parcouru qu'une fois ;
     *   • .xls / .csv : PhpSpreadsheet avec filtre de lignes (seules les lignes [début, fin] sont chargées en mémoire,
     *     le fichier est relu à chaque lot — acceptable : un .xls est plafonné à 65 536 lignes).
     *
     * @return Generator<int, array<int, array<int, mixed>>> clé = numéro de la 1re ligne Excel du lot (1-based), valeur = lignes
     */
    public static function lots(string $path, int $taille = 5000, ?string $feuille = null): Generator
    {
        $taille = max(500, $taille);

        if (self::estXlsx($path)) {
            $infos = XlsxStreamReader::feuilles($path);
            $cible = $feuille === null ? ($infos[0] ?? null) : (array_values(array_filter($infos, fn ($f) => $f['nom'] === $feuille))[0] ?? null);
            if ($cible === null) {
                throw new InvalidArgumentException('Feuille « '.($feuille ?? '1').' » introuvable dans le classeur.');
            }

            yield from XlsxStreamReader::lots($path, $cible['chemin'], $taille);

            return;
        }

        // .xls : la mémoire grimpe avec la taille du lot (5000 lignes ≈ 130 Mo, 2000 ≈ 80 Mo) ; plafonné pour tenir sous 128 Mo
        $taille = min($taille, 2000);

        $info = IOFactory::createReaderForFile($path);
        try {
            $feuilles = $info->listWorksheetInfo($path);
            $infoFeuille = $feuille === null ? ($feuilles[0] ?? []) : (array_values(array_filter($feuilles, fn ($f) => $f['worksheetName'] === $feuille))[0] ?? []);
            $nomFeuille = $infoFeuille['worksheetName'] ?? null;
            $total = (int) ($infoFeuille['totalRows'] ?? 0);
            $derniereCol = $infoFeuille['lastColumnLetter'] ?? 'AZ';
        } catch (\Throwable) {
            $total = 0; // lecteur sans listWorksheetInfo : repli sur une lecture complète
        }

        if ($total <= 0) {
            yield 1 => self::aoa($path);

            return;
        }

        for ($debut = 1; $debut <= $total; $debut += $taille) {
            $fin = min($debut + $taille - 1, $total);

            $reader = IOFactory::createReaderForFile($path);
            if (method_exists($reader, 'setReadDataOnly')) {
                $reader->setReadDataOnly(true);
            }
            $reader->setReadFilter(new class($debut, $fin) implements IReadFilter
            {
                public function __construct(private int $debut, private int $fin) {}

                public function readCell(string $columnAddress, int $row, string $worksheetName = ''): bool
                {
                    return $row >= $this->debut && $row <= $this->fin;
                }
            });
            if (! ($reader instanceof Csv) && $nomFeuille !== null) {
                $reader->setLoadSheetsOnly([$nomFeuille]);
            }

            $classeur = $reader->load($path);
            $lignes = $classeur->getSheet(0)->rangeToArray(
                "A{$debut}:{$derniereCol}{$fin}",
                null,
                calculateFormulas: false,
                formatData: false,
                returnCellRef: false,
                oldCalculatedValue: true,
            );
            $classeur->disconnectWorksheets();
            unset($classeur, $reader);

            yield $debut => array_values($lignes);
        }
    }

    /** Vrai .xlsx (archive ZIP contenant xl/workbook.xml), quelle que soit l'extension du fichier temporaire. */
    public static function estXlsx(string $path): bool
    {
        $f = @fopen($path, 'rb');
        if ($f === false) {
            return false;
        }
        $signature = fread($f, 4);
        fclose($f);
        if ($signature !== "PK\x03\x04") {
            return false;
        }

        $zip = new ZipArchive;
        if ($zip->open($path, ZipArchive::RDONLY) !== true) {
            return false;
        }
        $ok = $zip->locateName('xl/workbook.xml') !== false;
        $zip->close();

        return $ok;
    }

    /** Date → « Y-m-d H:i:s » (heure locale du fichier, sans conversion de fuseau) ou null si illisible. */
    public static function date(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        [$y, $mo, $d, $H, $M, $S] = [0, 0, 0, 0, 0, 0];

        if ($v instanceof DateTimeInterface) {
            [$y, $mo, $d, $H, $M, $S] = array_map('intval', explode('-', $v->format('Y-n-j-G-i-s')));
        } elseif (is_int($v) || is_float($v)) {
            if ($v < 20000 || $v > 80000) {
                return null;
            }
            $dt = XlDate::excelToDateTimeObject($v);
            [$y, $mo, $d, $H, $M, $S] = array_map('intval', explode('-', $dt->format('Y-n-j-G-i-s')));
        } else {
            $s = trim((string) $v);
            if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/', $s, $m)) {
                [$y, $mo, $d] = [(int) $m[1], (int) $m[2], (int) $m[3]];
                [$H, $M, $S] = [(int) ($m[4] ?? 0), (int) ($m[5] ?? 0), (int) ($m[6] ?? 0)];
            } elseif (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?#', $s, $m)) {
                [$d, $mo, $y] = [(int) $m[1], (int) $m[2], (int) $m[3]];
                [$H, $M, $S] = [(int) ($m[4] ?? 0), (int) ($m[5] ?? 0), (int) ($m[6] ?? 0)];
            } else {
                return null;
            }
        }

        if ($y <= 1990 || $y >= 2100 || ! checkdate($mo, $d, $y) || $H > 23 || $M > 59 || $S > 59) {
            return null;
        }

        return sprintf('%04d-%02d-%02d %02d:%02d:%02d', $y, $mo, $d, $H, $M, $S);
    }

    /** Cellule → chaîne propre (6212629.0 → "6212629", null → ""). */
    public static function texte(mixed $v): string
    {
        if ($v === null) {
            return '';
        }
        if (is_float($v) && floor($v) === $v && abs($v) < 1e15) {
            return sprintf('%.0f', $v);
        }
        if (is_bool($v)) {
            return $v ? '1' : '0';
        }

        return trim((string) $v);
    }

    /** Montant tolérant (« 7 500,00 » ou nombre). */
    public static function nombre(mixed $v): float
    {
        if (is_int($v) || is_float($v)) {
            return (float) $v;
        }
        $s = str_replace([' ', "\u{00A0}", ','], ['', '', '.'], (string) $v);

        return is_numeric($s) ? (float) $s : 0.0;
    }
}
