<?php

namespace App\Services;

use App\Support\ExcelReader;

/**
 * Lit ET valide un fichier d'objectifs. Remplace le message générique « Aucun objectif reconnu » par un diagnostic précis
 * (feuille lue, nombre de lignes, formules non calculées, en-têtes rencontrés…).
 */
final class ObjectifsValidator
{
    /**
     * @return array{equipes: array<int, array<string, mixed>>, logins: int, lignes_lues: int, avertissements: string[]}
     *
     * @throws ObjectifsInvalidesException
     */
    public function analyser(string $chemin): array
    {
        try {
            $aoa = ExcelReader::aoa($chemin, '/objectif/i');
        } catch (\Throwable $e) {
            throw new ObjectifsInvalidesException('Fichier illisible : ' . $e->getMessage() . ' (formats acceptés : .xlsx, .xls, .csv).');
        }

        if (!array_filter($aoa, fn ($r) => is_array($r) && array_filter($r, fn ($c) => $c !== null && $c !== ''))) {
            throw new ObjectifsInvalidesException('Le fichier est vide.');
        }

        $equipes = ObjectifsParser::parse($aoa);
        $nbLogins = array_sum(array_map(fn ($e) => count($e['logins']), $equipes));

        if (!$nbLogins) {
            throw new ObjectifsInvalidesException($this->messageEchec($aoa), $this->diagnostic($aoa, count($equipes)));
        }

        $avertissements = [];
        foreach ($equipes as $e) {
            if (!$e['logins']) {
                $avertissements[] = "L'équipe « {$e['id']} » n'a aucun login et sera ignorée des calculs par agent.";
            }
            foreach ($e['logins'] as $l) {
                if ($l['b2c'] < 0 || $l['b2b'] < 0) {
                    throw new ObjectifsInvalidesException("Objectif négatif pour « {$l['login']} » (équipe {$e['id']}) : corrigez le fichier.");
                }
            }
        }

        return ['equipes' => $equipes, 'logins' => $nbLogins, 'lignes_lues' => count($aoa), 'avertissements' => $avertissements];
    }

    /** @param array<int, array<int, mixed>> $aoa */
    private function messageEchec(array $aoa): string
    {
        $diag = $this->diagnostic($aoa, 0);
        if ($diag['formules_non_resolues'] > 0) {
            return "Le fichier contient {$diag['formules_non_resolues']} formule(s) sans valeur calculée. Ouvrez-le dans Excel, enregistrez-le (Ctrl+S) puis réimportez-le.";
        }
        if ($diag['logins_detectes'] === 0) {
            return "Aucun login d'agent trouvé (colonne « Login » du modèle exporté, ou logins se terminant par .ftth / commençant par pvt_, pms_, stg_ dans le fichier « OBJECTIFS TRACKING »).";
        }

        return "Des logins ont été trouvés ({$diag['logins_detectes']}) mais aucune équipe avec des objectifs chiffrés au-dessus d'eux : vérifiez les colonnes JOUR / SEM / MOIS du fichier.";
    }

    /** @param array<int, array<int, mixed>> $aoa @return array<string, mixed> */
    private function diagnostic(array $aoa, int $equipes): array
    {
        $formules = 0;
        $logins = 0;
        $premiere = null;
        foreach ($aoa as $r) {
            if (!is_array($r)) {
                continue;
            }
            $premiere ??= array_values(array_filter($r, fn ($c) => $c !== null && $c !== ''));
            foreach ($r as $c) {
                if (is_string($c) && isset($c[0]) && $c[0] === '=') {
                    $formules++;
                }
            }
            $b = trim((string) ($r[1] ?? ''));
            if ($b !== '' && (preg_match('/\.ftth$/i', $b) || preg_match('/^(pvt|pms|stg)[_-]/i', $b))) {
                $logins++;
            }
        }

        return ['lignes_lues' => count($aoa), 'equipes_detectees' => $equipes, 'logins_detectes' => $logins, 'formules_non_resolues' => $formules, 'premiere_ligne' => array_slice($premiere ?? [], 0, 8)];
    }
}
