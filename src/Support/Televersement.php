<?php

namespace App\Support;

use App\Config;
use App\Http\HttpException;
use App\Http\Request;

/**
 * Validation d'un fichier tableur envoyé (.xlsx, .xls, .csv) : présence, réception complète, extension, taille,
 * et CONTENU conforme à l'extension (un PDF ou une image renommés en « .xlsx » sont refusés avec un message clair,
 * au lieu d'échouer au milieu de l'import).
 */
final class Televersement
{
    /** Signature OLE2 (Compound File Binary) des classeurs Excel 97-2003 (.xls). */
    private const SIGNATURE_XLS = "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1";

    /** @return array{chemin: string, nom: string} */
    public static function tableur(Request $request, string $champ = 'fichier'): array
    {
        $f = $request->fichier($champ);
        if ($f === null || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            throw HttpException::validation($champ, 'Aucun fichier reçu.');
        }
        if ($f['error'] !== UPLOAD_ERR_OK || ! is_uploaded_file($f['tmp_name'])) {
            throw HttpException::validation($champ, 'Le fichier n\'a pas pu être reçu par le serveur : il dépasse probablement la limite de '.ini_get('upload_max_filesize')
                .' par fichier (post_max_size = '.ini_get('post_max_size').'). Limite réglable dans .user.ini à la racine du site.');
        }

        $nom = (string) $f['name'];
        $extension = strtolower(pathinfo($nom, PATHINFO_EXTENSION));
        if (! in_array($extension, ['xls', 'xlsx', 'csv'], true)) {
            throw HttpException::validation($champ, 'Format non accepté : seuls les fichiers .xlsx, .xls et .csv sont autorisés.');
        }

        $maxKo = Config::get('uploads.max_kb');
        if ($maxKo && $f['size'] > (int) $maxKo * 1024) {
            throw HttpException::validation($champ, 'Fichier trop volumineux (limite : '.(int) $maxKo.' Ko, réglable dans config/config.php).');
        }

        $chemin = $f['tmp_name'];
        $debut = (string) @file_get_contents($chemin, false, null, 0, 4096);
        $conforme = match ($extension) {
            'xlsx' => ExcelReader::estXlsx($chemin),
            'xls' => str_starts_with($debut, self::SIGNATURE_XLS),
            'csv' => $debut !== '' && preg_match('/[\x00-\x08\x0E-\x1F]/', $debut) === 0,   // texte sans octet binaire
        };
        if (! $conforme) {
            throw HttpException::validation($champ, "Le fichier « $nom » n'est pas un vrai fichier .$extension (contenu invalide ou corrompu). Réenregistrez-le depuis Excel au format .xlsx, .xls ou .csv.");
        }

        return ['chemin' => $chemin, 'nom' => $nom];
    }
}
