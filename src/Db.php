<?php

namespace App;

use PDO;
use PDOStatement;
use Throwable;

/** Accès MySQL / MariaDB (PDO) : requêtes préparées, transactions imbriquables, upsert par lots. */
final class Db
{
    private static ?PDO $pdo = null;

    private static int $niveauTransaction = 0;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $c = Config::get('db');
            $dsn = ! empty($c['socket'])
                ? "mysql:unix_socket={$c['socket']};dbname={$c['database']}"
                : "mysql:host={$c['host']};port={$c['port']};dbname={$c['database']}";
            $charset = $c['charset'] ?? 'utf8mb4';
            $collation = $c['collation'] ?? 'utf8mb4_unicode_ci';

            self::$pdo = new PDO($dsn.';charset='.$charset, $c['username'], $c['password'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ]);
            self::$pdo->exec("SET NAMES '$charset' COLLATE '$collation'");
            // Mode strict (comme l'ancienne version) : une valeur invalide est refusée au lieu d'être tronquée en silence
            self::$pdo->exec("SET SESSION sql_mode='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
        }

        return self::$pdo;
    }

    /** @param array<int|string, mixed> $params */
    public static function requete(string $sql, array $params = []): PDOStatement
    {
        $st = self::pdo()->prepare($sql);
        foreach (array_values($params) as $i => $v) {
            if (is_bool($v)) {
                $v = (int) $v;   // true/false → 1/0 : PDO enverrait sinon "1"/"" (refusé en mode strict)
            }
            $st->bindValue($i + 1, $v, match (true) {
                $v === null => PDO::PARAM_NULL,
                is_int($v) => PDO::PARAM_INT,
                default => PDO::PARAM_STR,
            });
        }
        $st->execute();

        return $st;
    }

    /**
     * @param  array<int|string, mixed>  $params
     * @return array<int, array<string, mixed>>
     */
    public static function select(string $sql, array $params = []): array
    {
        return self::requete($sql, $params)->fetchAll();
    }

    /**
     * @param  array<int|string, mixed>  $params
     * @return array<string, mixed>|null
     */
    public static function first(string $sql, array $params = []): ?array
    {
        $r = self::requete($sql, $params)->fetch();

        return $r === false ? null : $r;
    }

    /** @param array<int|string, mixed> $params */
    public static function value(string $sql, array $params = []): mixed
    {
        $v = self::requete($sql, $params)->fetchColumn();

        return $v === false ? null : $v;
    }

    /** @param array<int|string, mixed> $params */
    public static function executer(string $sql, array $params = []): int
    {
        return self::requete($sql, $params)->rowCount();
    }

    /** @param array<string, mixed> $valeurs */
    public static function insertGetId(string $table, array $valeurs): int
    {
        $cols = array_keys($valeurs);
        self::requete(
            'INSERT INTO `'.$table.'` ('.self::colonnes($cols).') VALUES ('.self::marques(count($cols)).')',
            array_values($valeurs)
        );

        return (int) self::pdo()->lastInsertId();
    }

    /**
     * INSERT … ON DUPLICATE KEY UPDATE par lot (la clé unique de la table décide du doublon).
     * Atomique côté SQL : deux écritures simultanées ne peuvent pas créer de doublon.
     *
     * @param  array<int, array<string, mixed>>  $lignes  toutes avec les mêmes colonnes, dans le même ordre
     * @param  string[]  $aMettreAJour  colonnes écrasées quand la ligne existe déjà
     */
    public static function upsert(string $table, array $lignes, array $aMettreAJour): int
    {
        if (! $lignes) {
            return 0;
        }
        $cols = array_keys($lignes[0]);
        $ligneSql = '('.self::marques(count($cols)).')';
        $params = [];
        foreach ($lignes as $l) {
            foreach ($cols as $c) {
                $params[] = $l[$c] ?? null;
            }
        }
        $maj = implode(', ', array_map(static fn (string $c) => "`$c` = VALUES(`$c`)", $aMettreAJour));

        return self::executer(
            'INSERT INTO `'.$table.'` ('.self::colonnes($cols).') VALUES '.implode(', ', array_fill(0, count($lignes), $ligneSql)).' ON DUPLICATE KEY UPDATE '.$maj,
            $params
        );
    }

    /**
     * Exécute $fn dans une transaction (imbriquable : seule la plus externe valide ou annule).
     *
     * @template T
     *
     * @param  callable(): T  $fn
     * @return T
     */
    public static function transaction(callable $fn): mixed
    {
        $pdo = self::pdo();
        if (self::$niveauTransaction === 0) {
            $pdo->beginTransaction();
        }
        self::$niveauTransaction++;
        try {
            $resultat = $fn();
            self::$niveauTransaction--;
            if (self::$niveauTransaction === 0) {
                $pdo->commit();
            }

            return $resultat;
        } catch (Throwable $e) {
            self::$niveauTransaction--;
            if (self::$niveauTransaction === 0 && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /** « ?, ?, ? » */
    public static function marques(int $n): string
    {
        return implode(', ', array_fill(0, max(1, $n), '?'));
    }

    /** Horodatage SQL courant (fuseau de l'application). */
    public static function maintenant(): string
    {
        return date('Y-m-d H:i:s');
    }

    /** @param string[] $cols */
    private static function colonnes(array $cols): string
    {
        return implode(', ', array_map(static fn (string $c) => "`$c`", $cols));
    }
}
