<?php

namespace App;

/**
 * Configuration : config/config.php (serveur), surchargé par config/config.local.php s'il existe (poste de développement),
 * puis complété par les constantes métier de l'application (colonnes Celtiis…).
 */
final class Config
{
    /** @var array<string, mixed>|null */
    private static ?array $valeurs = null;

    /** Lecture en notation pointée : Config::get('db.host'), Config::get('uploads.max_kb', 32768). */
    public static function get(string $cle, mixed $defaut = null): mixed
    {
        $v = self::tout();
        foreach (explode('.', $cle) as $segment) {
            if (! is_array($v) || ! array_key_exists($segment, $v)) {
                return $defaut;
            }
            $v = $v[$segment];
        }

        return $v;
    }

    /** @return array<string, mixed> */
    private static function tout(): array
    {
        if (self::$valeurs === null) {
            $dossier = dirname(__DIR__).'/config';
            $valeurs = require $dossier.'/config.php';
            if (is_file($dossier.'/config.local.php')) {
                $valeurs = array_replace_recursive($valeurs, require $dossier.'/config.local.php');
            }
            self::$valeurs = $valeurs + ['celtiis' => self::celtiis()];
        }

        return self::$valeurs;
    }

    /** @return array<string, mixed> */
    private static function celtiis(): array
    {
        return [
            // Colonnes du fichier « NouvellesSouscriptionOffre » dans l'ordre d'origine (réexportées telles quelles vers le JS).
            'colonnes' => [
                'ID_CLIENT', 'CODE', 'TYPE_CLIENT', 'PRENOM_NOM/RAISON_SOCIALE', 'STATUS', 'DATE_COMMANDE', 'MSISDN',
                'DATE_FIN_MSISDN', 'NOM_OFFRE', 'SCORE', 'DESCRIPTION_QUALITE_PAYEUR', 'DATE_PROVISIONNING', 'DATE_UPDATE',
                'MONTANT_TOTAL', 'DEBIT', 'REFERENCES_PAIEMENT', 'NUMERO_CCASH', 'FACTURE', 'DETAIL_COMMANDE', 'AGENCE',
                'LOGIN_VENDEUR', 'NOM_VENDEUR', 'CODE_OFFRE_COMMERCIALE', 'DETAIL_OPERATIONS', 'CODE_OFFRE',
                'DATE_EXECUTION_PREVUE', 'TYPE_COMMANDE',
            ],
            // Identique à OBLIGATOIRES de parser.js
            'obligatoires' => ['STATUS', 'DATE_COMMANDE', 'NOM_OFFRE', 'MONTANT_TOTAL', 'LOGIN_VENDEUR', 'TYPE_CLIENT', 'AGENCE'],
            'colonnes_date' => ['DATE_COMMANDE', 'DATE_FIN_MSISDN', 'DATE_PROVISIONNING', 'DATE_UPDATE', 'DATE_EXECUTION_PREVUE'],
            // Taille des lots d'upsert (limite de placeholders MySQL : 65 535)
            'chunk' => 400,
        ];
    }
}
