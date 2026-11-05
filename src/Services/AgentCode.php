<?php

namespace App\Services;

use App\Config;
use App\Db;
use App\Installer;
use App\Journal;
use PDOException;

/**
 * Code personnel à 4 chiffres des commerciaux RGZ (table agents_codes).
 *
 * Pas de compte à créer : à sa première connexion, le commercial tape son login puis choisit lui-même son code (deux fois).
 * Ensuite : login + code. Code oublié → l'administrateur le réinitialise (Paramètres › Utilisateurs), le commercial en choisit
 * un nouveau à sa connexion suivante. 5 codes faux pour un même login en 15 minutes : ce login est bloqué 15 minutes.
 */
final class AgentCode
{
    /** Codes refusés : trop faciles à deviner pour un collègue. */
    private const INTERDITS = ['1234', '4321', '0123', '3210', '2580', '1212', '1122', '1004', '2000', '1999', '6969'];

    /** @return array{cle: string, login: string, cree_le: string, derniere_connexion: ?string}|null */
    public static function lire(string $cle): ?array
    {
        return self::base(fn () => Db::first('SELECT `cle`, `login`, `cree_le`, `derniere_connexion` FROM `agents_codes` WHERE `cle` = ?', [$cle]));
    }

    /**
     * Date de la dernière réinitialisation si le code est EFFACÉ (le commercial doit en choisir un nouveau) ; null pour un
     * commercial qui n'a jamais eu de code (première connexion) ou dont le code existe.
     */
    public static function reinitialiseLe(string $cle): ?string
    {
        if (self::lire($cle) !== null) {
            return null;
        }
        $le = self::base(fn () => Db::value('SELECT MAX(`created_at`) FROM `agents_codes_reinit` WHERE `cle` = ?', [$cle]));

        return $le === null ? null : (string) $le;
    }

    /** Message d'erreur si le code choisi n'est pas acceptable, null s'il convient. */
    public static function refus(string $code, string $confirmation): ?string
    {
        if (! preg_match('/^\d{4}$/', $code)) {
            return 'Le code doit contenir exactement 4 chiffres (pas de lettres, pas d\'espace).';
        }
        if ($code !== $confirmation) {
            return 'Les deux codes ne sont pas identiques. Tapez le même code deux fois.';
        }
        if (count(array_unique(str_split($code))) === 1 || in_array($code, self::INTERDITS, true)) {
            return 'Ce code est trop facile à deviner (ex. 0000, 1111, 1234). Choisissez-en un autre.';
        }

        return null;
    }

    /**
     * Enregistre le code d'un login qui n'en a pas encore.
     *
     * @return string|null date de création (repère de la session), null si un code existe déjà (choisi entre-temps)
     */
    public static function creer(string $cle, string $login, string $code): ?string
    {
        $maintenant = Db::maintenant();
        $n = self::base(fn () => Db::executer(
            'INSERT IGNORE INTO `agents_codes` (`cle`, `login`, `code`, `cree_le`, `cree_ip`, `derniere_connexion`) VALUES (?, ?, ?, ?, ?, ?)',
            [$cle, $login, password_hash($code, PASSWORD_DEFAULT), $maintenant, self::ip(), $maintenant]
        ));
        if ($n !== 1) {
            return null;
        }
        Journal::avertissement('Espace commercial : code créé pour « '.$login.' » depuis '.self::ip().'.');

        return $maintenant;
    }

    /** @return string|null date de création du code (repère de la session) si le code est bon, sinon null (échec noté) */
    public static function verifier(string $cle, string $code): ?string
    {
        $r = self::base(fn () => Db::first('SELECT `code`, `cree_le` FROM `agents_codes` WHERE `cle` = ?', [$cle]));
        if ($r !== null && preg_match('/^\d{4}$/', $code) && password_verify($code, (string) $r['code'])) {
            Db::executer('DELETE FROM `connexions_echouees` WHERE `email` = ?', ['code:'.$cle]);
            Db::executer('UPDATE `agents_codes` SET `derniere_connexion` = ? WHERE `cle` = ?', [Db::maintenant(), $cle]);

            return (string) $r['cree_le'];
        }
        Db::insertGetId('connexions_echouees', ['email' => 'code:'.$cle, 'ip' => self::ip(), 'created_at' => Db::maintenant()]);
        Journal::avertissement('Espace commercial : code faux pour « '.$cle.' » depuis '.self::ip().'.');

        return null;
    }

    /** Essais restants avant blocage pour ce login (fenêtre de blocage_minutes). */
    public static function essaisRestants(string $cle): int
    {
        return max(0, self::max() - self::echecs($cle));
    }

    /** Minutes d'attente : 5 codes faux pour ce login, ou 20 depuis cette adresse (tous logins), dans la fenêtre. 0 = libre. */
    public static function minutesDeBlocage(string $cle): int
    {
        $fenetre = self::fenetre();
        $r = self::base(fn () => Db::first(
            "SELECT SUM(`email` = ?) AS login, SUM(`ip` = ?) AS ip, MAX(`created_at`) AS dernier FROM `connexions_echouees` WHERE `email` LIKE 'code:%' AND `created_at` >= ? AND (`email` = ? OR `ip` = ?)",
            ['code:'.$cle, self::ip(), date('Y-m-d H:i:s', time() - $fenetre), 'code:'.$cle, self::ip()]
        ));
        if (! $r || ((int) $r['login'] < self::max() && (int) $r['ip'] < 4 * self::max())) {
            return 0;
        }

        return max(1, (int) ceil(($fenetre - (time() - strtotime((string) $r['dernier']))) / 60));
    }

    /** Efface le code (oubli) : le commercial en choisira un nouveau ; le blocage éventuel de ce login est levé. */
    public static function reinitialiser(string $cle, string $admin): bool
    {
        return (bool) self::base(fn () => Db::transaction(static function () use ($cle, $admin) {
            $n = Db::executer('DELETE FROM `agents_codes` WHERE `cle` = ?', [$cle]);
            Db::executer('DELETE FROM `connexions_echouees` WHERE `email` = ?', ['code:'.$cle]);
            Db::insertGetId('agents_codes_reinit', ['cle' => $cle, 'admin' => mb_substr($admin, 0, 190), 'created_at' => Db::maintenant()]);
            Journal::avertissement('Espace commercial : code de « '.$cle.' » réinitialisé par '.$admin.'.');

            return $n;
        }));
    }

    /**
     * Tous les commerciaux RGZ connus (objectifs), avec l'état de leur code.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function liste(): array
    {
        $fenetre = date('Y-m-d H:i:s', time() - self::fenetre());

        return self::base(fn () => array_map(static fn (array $r) => [
            'cle' => $r['cle'],
            'login' => $r['login'],
            'equipe' => $r['equipe'],
            'mois' => $r['mois'],
            'code' => $r['cree_le'] !== null,
            'cree_le' => $r['cree_le'],
            'derniere_connexion' => $r['derniere_connexion'],
            'bloque' => (int) $r['echecs'] >= self::max(),
            'reinit_le' => $r['reinit_le'],
            'reinit_par' => $r['reinit_par'],
        ], Db::select(
            "SELECT o.`cle`, o.`login`, o.`equipe`, o.`mois`, c.`cree_le`, c.`derniere_connexion`,
                (SELECT COUNT(*) FROM `connexions_echouees` e WHERE e.`email` = CONCAT('code:', o.`cle`) AND e.`created_at` >= ?) AS echecs,
                (SELECT MAX(r.`created_at`) FROM `agents_codes_reinit` r WHERE r.`cle` = o.`cle`) AS reinit_le,
                (SELECT r.`admin` FROM `agents_codes_reinit` r WHERE r.`cle` = o.`cle` ORDER BY r.`created_at` DESC, r.`id` DESC LIMIT 1) AS reinit_par
             FROM `mensual_objectives` o
             JOIN (SELECT `cle`, MAX(`mois`) AS mois FROM `mensual_objectives` WHERE `niveau` = 'login' GROUP BY `cle`) d ON d.`cle` = o.`cle` AND d.`mois` = o.`mois`
             LEFT JOIN `agents_codes` c ON c.`cle` = o.`cle`
             WHERE o.`niveau` = 'login'
             ORDER BY o.`equipe`, o.`login`",
            [$fenetre]
        )));
    }

    private static function echecs(string $cle): int
    {
        return (int) self::base(fn () => Db::value(
            'SELECT COUNT(*) FROM `connexions_echouees` WHERE `email` = ? AND `created_at` >= ?',
            ['code:'.$cle, date('Y-m-d H:i:s', time() - self::fenetre())]
        ));
    }

    private static function max(): int
    {
        return max(3, (int) Config::get('auth.tentatives_max', 5));
    }

    private static function fenetre(): int
    {
        return max(1, (int) Config::get('auth.blocage_minutes', 15)) * 60;
    }

    private static function ip(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    }

    /**
     * Tables créées au premier appel si elles manquent (comme le reste de l'application).
     *
     * @template T
     *
     * @param  callable(): T  $fn
     * @return T
     */
    private static function base(callable $fn): mixed
    {
        try {
            return $fn();
        } catch (PDOException $e) {
            if (! Installer::tableManquante($e)) {
                throw $e;
            }
            Installer::installer();

            return $fn();
        }
    }
}
