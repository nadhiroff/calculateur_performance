<?php

namespace App\Support;

use Generator;
use InvalidArgumentException;
use PhpOffice\PhpSpreadsheet\Shared\StringHelper;
use XMLReader;
use ZipArchive;

/**
 * Lecture EN FLUX d'un .xlsx (XMLReader sur le XML de la feuille, directement dans l'archive ZIP).
 *
 * Pourquoi : PhpSpreadsheet, même avec un filtre de lignes, re-parse TOUT le fichier à chaque lot. Mesuré sur FTTH.xlsx
 * (10 Mo, 59 150 lignes) : ≈ 18 s par lot de 5 000 lignes, soit plus de 3 minutes de lecture. Ici le fichier est lu
 * UNE seule fois, ligne par ligne, avec une mémoire bornée (table des chaînes partagées + un lot).
 *
 * Valeurs renvoyées identiques à ExcelReader (lecture « données seules ») : nombres bruts (les dates restent des numéros
 * de série Excel), chaînes, booléens, et pour les formules la valeur EN CACHE calculée par Excel.
 */
final class XlsxStreamReader
{
    private const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    /**
     * Feuilles du classeur, dans l'ordre des onglets.
     *
     * @return array<int, array{nom: string, chemin: string}>
     */
    public static function feuilles(string $path): array
    {
        $zip = self::ouvrir($path);
        $workbook = $zip->getFromName('xl/workbook.xml');
        $rels = $zip->getFromName('xl/_rels/workbook.xml.rels');
        $zip->close();

        if ($workbook === false || $rels === false) {
            throw new InvalidArgumentException('Classeur Excel illisible : structure .xlsx incomplète (xl/workbook.xml absent).');
        }

        $cibles = [];
        foreach (simplexml_load_string($rels)->Relationship as $r) {
            $cible = ltrim((string) $r['Target'], '/');
            $cibles[(string) $r['Id']] = str_starts_with($cible, 'xl/') ? $cible : 'xl/'.$cible;
        }

        $feuilles = [];
        foreach (simplexml_load_string($workbook)->sheets->sheet as $s) {
            $id = (string) $s->attributes(self::NS_REL)['id'];
            if (isset($cibles[$id])) {
                $feuilles[] = ['nom' => (string) $s['name'], 'chemin' => $cibles[$id]];
            }
        }

        return $feuilles;
    }

    /**
     * Lignes de la feuille par lots de $taille. Lignes absentes du XML (vides) restituées comme des lignes de null,
     * pour que les numéros de ligne Excel restent exacts dans les messages de rejet.
     *
     * @return Generator<int, array<int, array<int, mixed>>> clé = numéro de la 1re ligne Excel du lot (1-based)
     */
    public static function lots(string $path, string $cheminFeuille, int $taille): Generator
    {
        $partagees = self::chainesPartagees($path);

        $xml = new XMLReader;
        if (! @$xml->open('zip://'.$path.'#'.$cheminFeuille, null, LIBXML_NONET | LIBXML_COMPACT)) {
            throw new InvalidArgumentException("Feuille introuvable dans le classeur ($cheminFeuille).");
        }

        $debut = 1;
        $lot = [];
        $largeur = 0;
        $numLigne = 0;

        try {
            while ($xml->read()) {
                if ($xml->nodeType !== XMLReader::ELEMENT || $xml->localName !== 'row') {
                    continue;
                }
                $numLigne = (int) ($xml->getAttribute('r') ?: $numLigne + 1);
                $cellules = $xml->isEmptyElement ? [] : self::lireLigne($xml, $partagees);

                while ($numLigne >= $debut + $taille) {
                    if ($lot) {
                        yield $debut => self::completer($lot, $debut, $debut + $taille - 1, $largeur);
                    }
                    $lot = [];
                    $debut += $taille;
                }
                if ($cellules) {
                    $lot[$numLigne] = $cellules;
                    $largeur = max($largeur, array_key_last($cellules) + 1);
                }
            }
        } finally {
            $xml->close();
        }

        if ($lot) {
            yield $debut => self::completer($lot, $debut, array_key_last($lot), $largeur);
        }
    }

    /** @return array<int, mixed>  index de colonne (0-based) → valeur */
    private static function lireLigne(XMLReader $xml, array $partagees): array
    {
        $cellules = [];
        $col = -1;

        while ($xml->read()) {
            if ($xml->nodeType === XMLReader::END_ELEMENT && $xml->localName === 'row') {
                break;
            }
            if ($xml->nodeType !== XMLReader::ELEMENT || $xml->localName !== 'c') {
                continue;
            }
            $ref = $xml->getAttribute('r');
            $col = $ref !== null ? self::indexColonne($ref) : $col + 1;
            $type = $xml->getAttribute('t') ?? 'n';
            if ($xml->isEmptyElement) {
                continue;
            }

            $brut = null;
            $inline = '';
            while ($xml->read()) {
                if ($xml->nodeType === XMLReader::END_ELEMENT && $xml->localName === 'c') {
                    break;
                }
                if ($xml->nodeType === XMLReader::ELEMENT && $xml->localName === 'v') {
                    $brut = $xml->readString();
                } elseif ($xml->nodeType === XMLReader::ELEMENT && $xml->localName === 't') {
                    $inline .= $xml->readString();
                }
            }

            $valeur = match ($type) {
                's' => $partagees[(int) $brut] ?? null,
                'inlineStr' => self::texte($inline),
                'b' => $brut === null ? null : $brut === '1',
                'str' => $brut === null ? null : self::texte($brut),
                'e', 'd' => $brut,
                default => self::nombre($brut),
            };
            if ($valeur !== null && $valeur !== '') {
                $cellules[$col] = $valeur;
            }
        }

        return $cellules;
    }

    /**
     * @param  array<int, array<int, mixed>>  $lot
     * @return array<int, array<int, mixed>>
     */
    private static function completer(array $lot, int $debut, int $fin, int $largeur): array
    {
        $vide = array_fill(0, max(1, $largeur), null);
        $lignes = [];
        for ($n = $debut; $n <= $fin; $n++) {
            $lignes[] = isset($lot[$n]) ? array_replace($vide, $lot[$n]) : $vide;
        }

        return $lignes;
    }

    /** @return array<int, string> */
    private static function chainesPartagees(string $path): array
    {
        $zip = self::ouvrir($path);
        $existe = $zip->locateName('xl/sharedStrings.xml') !== false;
        $zip->close();
        if (! $existe) {
            return [];
        }

        $xml = new XMLReader;
        $xml->open('zip://'.$path.'#xl/sharedStrings.xml', null, LIBXML_NONET | LIBXML_COMPACT);
        $chaines = [];
        $courante = null;
        $profondeurPhonetique = 0;

        while ($xml->read()) {
            if ($xml->nodeType === XMLReader::ELEMENT) {
                if ($xml->localName === 'si') {
                    $courante = '';
                    if ($xml->isEmptyElement) {
                        $chaines[] = '';
                        $courante = null;
                    }
                } elseif ($xml->localName === 'rPh' && ! $xml->isEmptyElement) {
                    $profondeurPhonetique++;   // annotations phonétiques (japonais) : hors du texte affiché
                } elseif ($xml->localName === 't' && $courante !== null && $profondeurPhonetique === 0) {
                    $courante .= $xml->readString();
                }
            } elseif ($xml->nodeType === XMLReader::END_ELEMENT) {
                if ($xml->localName === 'rPh') {
                    $profondeurPhonetique--;
                } elseif ($xml->localName === 'si') {
                    $chaines[] = self::texte($courante ?? '');
                    $courante = null;
                }
            }
        }
        $xml->close();

        return $chaines;
    }

    /**
     * Caractères échappés (« _x000D_ ») décodés, fins de ligne normalisées en \n : même texte que PhpSpreadsheet.
     * L'hexadécimal est remis en majuscules : SheetJS (conversion .xls → .xlsx dans le navigateur) écrit « _x000d_ ».
     */
    private static function texte(string $s): string
    {
        if (! str_contains($s, '_x')) {
            return $s;
        }
        $s = (string) preg_replace_callback('/_x([0-9a-fA-F]{4})_/', static fn (array $m) => '_x'.strtoupper($m[1]).'_', $s);

        return str_replace(["\r\n", "\r"], "\n", StringHelper::controlCharacterOOXML2PHP($s));
    }

    private static function nombre(?string $brut): int|float|null
    {
        if ($brut === null || $brut === '') {
            return null;
        }
        if (preg_match('/^-?\d{1,18}$/', $brut)) {
            return (int) $brut;
        }

        return is_numeric($brut) ? (float) $brut : null;
    }

    /** « AB12 » → 27 */
    private static function indexColonne(string $ref): int
    {
        $n = 0;
        $len = strlen($ref);
        for ($i = 0; $i < $len; $i++) {
            $o = ord($ref[$i]);
            if ($o < 65 || $o > 90) {
                break;
            }
            $n = $n * 26 + ($o - 64);
        }

        return $n - 1;
    }

    private static function ouvrir(string $path): ZipArchive
    {
        $zip = new ZipArchive;
        if ($zip->open($path, ZipArchive::RDONLY) !== true) {
            throw new InvalidArgumentException('Fichier .xlsx illisible ou corrompu (archive ZIP invalide).');
        }

        return $zip;
    }
}
