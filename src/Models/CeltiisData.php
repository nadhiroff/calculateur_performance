<?php

namespace App\Models;

use App\Config;
use App\Db;
use App\Services\CeltiisRowMapper;
use App\Support\Cache;
use App\Support\LoginKey;
use PDOException;

/** Souscriptions Celtiis (table celtiis_datas). */
final class CeltiisData
{
    /** Colonnes mises à jour quand la ligne existe déjà. La clé, created_at et import_id n'y sont pas : ils ne changent jamais. */
    public const COLONNES_MODIFIABLES = [
        'code', 'type_client', 'client_nom', 'statut', 'nom_offre', 'montant_total', 'agence', 'login_vendeur', 'login_key',
        'nom_vendeur', 'date_provisioning', 'date_update', 'source', 'raw', 'row_hash', 'last_import_id', 'updated_at',
    ];

    /**
     * UPSERT par lots. Atomique côté SQL (INSERT … ON DUPLICATE KEY UPDATE) : même si deux imports tournent en même temps,
     * la contrainte unique (date_commande, id_client, msisdn) empêche tout doublon.
     *
     * @param  array<int, array<string, mixed>>  $lignes  lignes normalisées (CeltiisRowMapper)
     */
    public static function upsertLots(array $lignes, int $importId): int
    {
        $now = Db::maintenant();
        $n = 0;
        foreach (array_chunk($lignes, (int) Config::get('celtiis.chunk', 400)) as $lot) {
            $rows = array_map(static function (array $l) use ($importId, $now) {
                $l['raw'] = json_encode($l['raw'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                $l['source'] = 'import';
                $l['import_id'] = $importId;
                $l['last_import_id'] = $importId;
                $l['created_at'] = $now;
                $l['updated_at'] = $now;

                return $l;
            }, $lot);

            Db::upsert('celtiis_datas', $rows, self::COLONNES_MODIFIABLES);
            $n += count($rows);
        }

        return $n;
    }

    /**
     * Lignes déjà en base pour une plage de dates et une liste de clients : clé « date|client|msisdn » →
     * [hash, date_update, au]. « au » = dernière date du fichier qui a écrit la ligne (null : ligne manuelle ou import inconnu) ;
     * avec date_update, il permet de ne jamais remplacer une ligne par celle d'un fichier plus ancien.
     *
     * @param  string[]  $clients
     * @return array<string, array{hash: string, date_update: ?string, au: ?string}>
     */
    public static function empreintes(string $du, string $au, array $clients): array
    {
        $existantes = [];
        foreach (array_chunk($clients, 1000) as $tranche) {
            $st = Db::requete(
                'SELECT c.`date_commande`, c.`id_client`, c.`msisdn`, c.`row_hash`, c.`date_update`, JSON_UNQUOTE(JSON_EXTRACT(i.`stats`, \'$.au\')) AS `au`'
                .' FROM `celtiis_datas` c LEFT JOIN `imports` i ON i.`id` = c.`last_import_id`'
                .' WHERE c.`date_commande` BETWEEN ? AND ? AND c.`id_client` IN ('.Db::marques(count($tranche)).')',
                [$du, $au, ...$tranche]
            );
            while ($e = $st->fetch()) {
                $existantes[CeltiisRowMapper::cle($e['date_commande'], $e['id_client'], $e['msisdn'])] = [
                    'hash' => $e['row_hash'], 'date_update' => $e['date_update'], 'au' => $e['au'] === 'null' ? null : $e['au'],
                ];
            }
        }

        return $existantes;
    }

    /**
     * Ajout MANUEL d'une ligne : refuse proprement si la clé existe déjà (la cohérence prime).
     *
     * @param  array<string, mixed>  $attrs
     * @return array{0: int, 1: bool} [id, créée ?]
     */
    public static function ajouterManuellement(array $attrs): array
    {
        $cle = [
            'date_commande' => $attrs['date_commande'],
            'id_client' => $attrs['id_client'],
            'msisdn' => $attrs['msisdn'] ?? '',
        ];
        $valeurs = [
            'code' => $attrs['code'] ?? null,
            'type_client' => mb_strtoupper($attrs['type_client'] ?? ''),
            'client_nom' => $attrs['client_nom'] ?? null,
            'statut' => mb_strtoupper($attrs['statut']),
            'nom_offre' => $attrs['nom_offre'] ?? null,
            'montant_total' => $attrs['montant_total'] ?? 0,
            'agence' => $attrs['agence'] ?? null,
            'login_vendeur' => isset($attrs['login_vendeur']) ? mb_strtolower($attrs['login_vendeur']) : null,
            'login_key' => LoginKey::from($attrs['login_vendeur'] ?? ''),
            'nom_vendeur' => $attrs['nom_vendeur'] ?? null,
            'date_provisioning' => $attrs['date_provisioning'] ?? null,
            'date_update' => $attrs['date_update'] ?? null,
            'source' => 'manuel',
        ];
        $valeurs['row_hash'] = CeltiisRowMapper::empreinte($valeurs);
        // « raw » reconstitué avec les en-têtes d'origine pour que la ligne soit relue comme les autres par le JS
        $valeurs['raw'] = json_encode(array_filter([
            'ID_CLIENT' => $cle['id_client'], 'CODE' => $valeurs['code'], 'TYPE_CLIENT' => $valeurs['type_client'],
            'PRENOM_NOM/RAISON_SOCIALE' => $valeurs['client_nom'], 'STATUS' => $valeurs['statut'],
            'DATE_COMMANDE' => $cle['date_commande'], 'MSISDN' => $cle['msisdn'], 'NOM_OFFRE' => $valeurs['nom_offre'],
            'DATE_PROVISIONNING' => $valeurs['date_provisioning'], 'DATE_UPDATE' => $valeurs['date_update'],
            'MONTANT_TOTAL' => $valeurs['montant_total'], 'AGENCE' => $valeurs['agence'],
            'LOGIN_VENDEUR' => $valeurs['login_vendeur'], 'NOM_VENDEUR' => $valeurs['nom_vendeur'],
        ], static fn ($v) => $v !== null), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $existant = self::idParCle($cle);
        if ($existant !== null) {
            return [$existant, false];
        }

        $now = Db::maintenant();
        try {
            $id = Db::insertGetId('celtiis_datas', $cle + $valeurs + ['created_at' => $now, 'updated_at' => $now]);
            Cache::invalider();   // vente ajoutée à la main : résultats des commerciaux à recalculer

            return [$id, true];
        } catch (PDOException $e) {
            if (($e->errorInfo[1] ?? null) !== 1062) {
                throw $e;
            }

            return [(int) self::idParCle($cle), false];   // course perdue contre un autre INSERT identique
        }
    }

    /** @param array{date_commande: string, id_client: string, msisdn: string} $cle */
    private static function idParCle(array $cle): ?int
    {
        $id = Db::value('SELECT `id` FROM `celtiis_datas` WHERE `date_commande` = ? AND `id_client` = ? AND `msisdn` = ? LIMIT 1', array_values($cle));

        return $id === null ? null : (int) $id;
    }

    /**
     * Clause WHERE des filtres de consultation : du, au, mois, statut (liste), type_client, agence, login, offre.
     *
     * @param  array<string, mixed>  $f
     * @return array{0: string, 1: array<int, mixed>}  [« WHERE … » ou « », paramètres]
     */
    public static function filtrer(array $f): array
    {
        $where = [];
        $params = [];

        $statuts = $f['statut'] ?? null;
        if (is_string($statuts)) {
            $statuts = array_values(array_filter(array_map('trim', explode(',', $statuts))));
        }

        if (! empty($f['mois'])) {
            $where[] = '`mois` = ?';
            $params[] = $f['mois'];
        }
        if (! empty($f['du'])) {
            $where[] = '`jour` >= ?';
            $params[] = $f['du'];
        }
        if (! empty($f['au'])) {
            $where[] = '`jour` <= ?';
            $params[] = $f['au'];
        }
        if (! empty($statuts)) {
            $statuts = array_map('mb_strtoupper', (array) $statuts);
            $where[] = '`statut` IN ('.Db::marques(count($statuts)).')';
            array_push($params, ...$statuts);
        }
        if (! empty($f['type_client'])) {
            $where[] = '`type_client` = ?';
            $params[] = mb_strtoupper($f['type_client']);
        }
        if (! empty($f['agence'])) {
            $where[] = '`agence` LIKE ?';
            $params[] = '%'.$f['agence'].'%';
        }
        if (! empty($f['login'])) {
            $where[] = '`login_key` LIKE ?';
            $params[] = '%'.LoginKey::from($f['login']).'%';
        }
        if (! empty($f['offre'])) {
            $where[] = '`nom_offre` LIKE ?';
            $params[] = '%'.$f['offre'].'%';
        }

        return [$where ? ' WHERE '.implode(' AND ', $where) : '', $params];
    }
}
