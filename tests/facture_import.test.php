<?php
/* Lecture des fichiers « POINT VENTES » (src/Services/FactureImporter.php) sur les vrais fichiers d'août et septembre 2026.
   Lancer : php tests/facture_import.test.php   (lecture seule : rien n'est écrit en base)
   Attendus = feuilles « FACTURE A FAIRE » / « POINT DES VENTES » des fichiers eux-mêmes. */
require dirname(__DIR__).'/vendor/autoload.php';

use App\Services\FactureImporter;

$ok = 0;
$ko = 0;
$t = function (string $nom, $attendu, $obtenu) use (&$ok, &$ko) {
    if ($attendu === $obtenu) { $ok++; echo "  ✔ $nom\n"; } else { $ko++; echo "  ✘ $nom : attendu ".json_encode($attendu).', obtenu '.json_encode($obtenu)."\n"; }
};
$compter = function (array $lignes): array {
    $e = ['PAYE' => 0, 'REPORT_PAYE' => 0, 'REPORTE' => 0, 'NON_VALIDE' => 0];
    $d = [];
    foreach ($lignes as $l) {
        $e[$l['etat']]++;
        if ($l['etat'] === 'PAYE' || $l['etat'] === 'REPORT_PAYE') { $d[$l['debit']] = ($d[$l['debit']] ?? 0) + 1; }
    }
    ksort($d);

    return [$e, $d];
};
$dossier = dirname(__DIR__).'/document_test/factures';

echo "\nAoût 2026 : « LISTE DES CLIENTS », arriéré mélangé dans la liste (colonnes décalées)\n";
$r = (new FactureImporter())->lire("$dossier/POINT DES VENTES FTTH RGZ AOUT 2026.xlsx", 'POINT DES VENTES FTTH RGZ AOUT 2026.xlsx');
[$e, $d] = $compter($r['lignes']);
$t('mois 2026-08', '2026-08', $r['mois']);
$t('une seule feuille lue : LISTE DES CLIENTS', ['LISTE DES CLIENTS'], array_column($r['feuilles'], 'nom'));
$t('582 à payer + 1 arriéré, 28 reportés, 30 non validés', ['PAYE' => 582, 'REPORT_PAYE' => 1, 'REPORTE' => 28, 'NON_VALIDE' => 30], $e);
$t('facturées par débit = FACTURE A FAIRE (578 × 50M + 5 × 100M = 583)', ['FTTH_HOME_100M' => 5, 'FTTH_HOME_50M' => 578], $d);
$arr = array_values(array_filter($r['lignes'], fn ($l) => $l['liste'] === 'arrieres'))[0] ?? [];
$t('arriéré : login, débit et date lus malgré le décalage', ['pvt_rgz_rclotoe', 'FTTH_HOME_50M', '2026-07-29'], [$arr['login_key'] ?? null, $arr['debit'] ?? null, substr((string) ($arr['date_commande'] ?? ''), 0, 10)]);

echo "\nSeptembre 2026 : « LISTE CLIENTS », colonnes dans un autre ordre\n";
$r = (new FactureImporter())->lire("$dossier/POINT VENTES FTTH RGZ SEPTEMBRE 2026.xlsx", 'POINT VENTES FTTH RGZ SEPTEMBRE 2026.xlsx');
[$e, $d] = $compter($r['lignes']);
$t('mois 2026-09', '2026-09', $r['mois']);
$t('une seule feuille lue : LISTE CLIENTS', ['LISTE CLIENTS'], array_column($r['feuilles'], 'nom'));
$t('1 010 à payer, 75 reportés, 56 non validés', ['PAYE' => 1010, 'REPORT_PAYE' => 0, 'REPORTE' => 75, 'NON_VALIDE' => 56], $e);
$t('facturées par débit = FACTURE A FAIRE (13 + 996 + 1 = 1 010)', ['FTTH_HOME_100M' => 13, 'FTTH_HOME_50M' => 996, 'FTTH_PRO_50M' => 1], $d);

echo "\nRègles de détection\n";
$t('« Listes client » → clients', 'clients', FactureImporter::sourceDuNom('Listes client'));
$t('« LISTE DES ARRIÉRÉS » → arrieres', 'arrieres', FactureImporter::sourceDuNom('LISTE DES ARRIÉRÉS'));
$t('« LISTE PAIEMENTS » ignorée', null, FactureImporter::sourceDuNom('LISTE PAIEMENTS'));
$t('« FACTURE A FAIRE » ignorée', null, FactureImporter::sourceDuNom('FACTURE A FAIRE'));
$t('« A PAYER » → PAYE', ['clients', 'PAYE'], FactureImporter::etat('A PAYER', '', 'clients'));
$t('« Arrièrés à payer en Août » → arriéré facturé', ['arrieres', 'REPORT_PAYE'], FactureImporter::etat('Arrièrés à payer en Août', '', 'clients'));
$t('ligne d\'une feuille d\'arriérés sans PAIEMENT → arriéré facturé', ['arrieres', 'REPORT_PAYE'], FactureImporter::etat('', '', 'arrieres'));
$t('« PAIEMENT REPORTE » → REPORTE', ['clients', 'REPORTE'], FactureImporter::etat('PAIEMENT REPORTE', '', 'clients'));
$t('« VENTE NON VALIDEE » → NON_VALIDE', ['clients', 'NON_VALIDE'], FactureImporter::etat('VENTE NON VALIDEE', '', 'clients'));
$t('mois du nom de fichier', '2026-09', FactureImporter::moisDuNom('POINT VENTES FTTH RGZ SEPTEMBRE 2026.xlsx'));
$t('mois du nom de fichier (Août accentué)', '2026-08', FactureImporter::moisDuNom('Point des ventes Août 2026.xlsx'));

echo "\nFichier B2B envoyé à part (« RGZ fichier B2B.xlsx », feuille REAL, colonnes OBSERVATION / TYPE_VENTE)\n";
$b2b = dirname(__DIR__).'/document_test/Cahier de charge abdallah/RGZ fichier B2B.xlsx';
if (is_file($b2b)) {
    $r = (new FactureImporter())->lire($b2b, 'RGZ fichier B2B.xlsx');
    [$e] = $compter($r['lignes']);
    $t('mois 2026-09 (dates Excel)', '2026-09', $r['mois']);
    $t('seule la feuille REAL est lue, en B2B', [['REAL', 'b2b']], array_map(fn ($f) => [$f['nom'], $f['source']], $r['feuilles']));
    $t('= RECAP du fichier : 84 payées dont 1 report (Vente Juillet), 6 reportées', ['PAYE' => 83, 'REPORT_PAYE' => 1, 'REPORTE' => 6, 'NON_VALIDE' => 0], $e);
}
$t('« Vente Sept » → septembre', 9, FactureImporter::moisDeVente('Vente Sept'));
$t('« Vente d\'Août 2026 » → août', 8, FactureImporter::moisDeVente("Vente d'Août 2026"));
$t('« A PARTIRE DU 17 JUIN 26 » n\'est pas un mois de vente', null, FactureImporter::moisDeVente('A PARTIRE DU 17 JUIN 26'));

echo "\n$ok réussis, $ko échec(s)\n";
exit($ko ? 1 : 0);
