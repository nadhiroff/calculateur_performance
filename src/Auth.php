<?php

namespace App;

use PDOException;

/**
 * Connexion des administrateurs (table admins) : session PHP, blocage après plusieurs échecs, expiration.
 *
 * Les comptes sont créés à la main dans phpMyAdmin. Un mot de passe saisi EN CLAIR dans la colonne mot_de_passe
 * est accepté une fois puis remplacé par son empreinte (password_hash) : la base ne garde jamais le mot de passe lisible.
 *
 * La session est lue en « read_and_close » : un import long ne bloque pas les autres onglets du même administrateur.
 */
final class Auth
{
    private const COOKIE = 'calcperf_session';   // distinct de PHPSESSID : le site formulaire est sur le même domaine

    /** Empreinte factice : vérifiée quand l'email est inconnu, pour que la réponse prenne le même temps. */
    private const EMPREINTE_FACTICE = '$2y$12$s4uT1muW3feJwvmhMFXreuiC8rcyChpfC6Dcc/1tDfAnyHMXlIJHi';

    /** Session ouverte pendant CETTE requête (connexion : nouvel identifiant) : prioritaire sur le cookie reçu. */
    private static ?string $idCourant = null;

    /** Fréquence (secondes) à laquelle la session est prolongée et le compte revérifié en base (actif ? toujours là ?). */
    private const REVERIFICATION = 60;

    /** @return array{id: int, email: string, nom: ?string, debut: int, vu: int}|null administrateur connecté */
    public static function admin(): ?array
    {
        self::demarrer(true);
        $a = $_SESSION['admin'] ?? null;
        if (! is_array($a)) {
            return null;
        }

        $maintenant = time();
        if ($maintenant - $a['vu'] > self::inactiviteAdmin() * 60
            || $maintenant - $a['debut'] > self::reglage('duree_max_heures', 12) * 3600) {
            self::deconnecter('admin');

            return null;
        }

        if ($maintenant - $a['vu'] > self::REVERIFICATION) {
            $compte = self::base(fn () => Db::first('SELECT `id`, `email`, `nom`, `actif` FROM `admins` WHERE `id` = ?', [$a['id']]));
            if (! $compte || ! $compte['actif']) {
                self::deconnecter('admin');

                return null;
            }
            $a = ['email' => $compte['email'], 'nom' => $compte['nom'], 'vu' => $maintenant] + $a;
            self::demarrer(false, false);   // sans Set-Cookie
            $_SESSION['admin'] = $a;
            session_write_close();
        }

        return $a;
    }

    /** Minutes sans activité avant déconnexion d'un administrateur (30 par défaut). */
    public static function inactiviteAdmin(): int
    {
        return max(5, self::reglage('inactivite_minutes', 30));
    }

    /**
     * Pages protégées : renvoie l'administrateur connecté, sinon redirige vers la page de connexion.
     *
     * @return array{id: int, email: string, nom: ?string, debut: int, vu: int}
     */
    public static function exiger(string $page): array
    {
        $a = self::admin();
        header('Cache-Control: no-store, private');   // bouton « Précédent » après déconnexion : pas de page en cache
        if ($a === null) {
            header('Location: connexion.php?retour='.rawurlencode($page), true, 302);
            exit;
        }

        return $a;
    }

    /**
     * Vérifie email + mot de passe et ouvre la session.
     *
     * @return string|null message d'erreur à afficher, null si connecté
     */
    public static function connecter(string $email, string $motDePasse): ?string
    {
        $email = mb_strtolower(trim($email));
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        if ($email === '' || $motDePasse === '') {
            return 'Saisissez votre email et votre mot de passe.';
        }

        $attente = self::minutesDeBlocage($email, $ip);
        if ($attente > 0) {
            return 'Trop de tentatives échouées. Réessayez dans '.$attente.' minute'.($attente > 1 ? 's' : '').'.';
        }

        $compte = self::base(fn () => Db::first('SELECT * FROM `admins` WHERE `email` = ?', [$email]));
        $valide = $compte !== null && self::verifierMotDePasse($compte, $motDePasse);
        if ($compte === null) {
            password_verify($motDePasse, self::EMPREINTE_FACTICE);
        }

        if (! $valide) {
            Db::executer('DELETE FROM `connexions_echouees` WHERE `created_at` < ?', [date('Y-m-d H:i:s', time() - 86400)]);
            Db::insertGetId('connexions_echouees', ['email' => $email, 'ip' => $ip, 'created_at' => Db::maintenant()]);
            Journal::avertissement('Connexion refusée pour « '.mb_substr($email, 0, 190).' » depuis '.$ip.'.');

            return 'Email ou mot de passe incorrect.';
        }
        if (! $compte['actif']) {
            return 'Ce compte est désactivé. Contactez la direction.';
        }

        Db::executer('DELETE FROM `connexions_echouees` WHERE `email` = ? AND `ip` = ?', [$email, $ip]);
        Db::executer('UPDATE `admins` SET `derniere_connexion` = ? WHERE `id` = ?', [Db::maintenant(), $compte['id']]);

        self::demarrer();
        session_regenerate_id(true);   // nouvel identifiant : un identifiant de session connu avant la connexion ne sert à rien
        self::$idCourant = session_id();
        $maintenant = time();
        // Seule la partie « admin » est écrite : un commercial connecté dans le même navigateur le reste
        $_SESSION['admin'] = ['id' => (int) $compte['id'], 'email' => $compte['email'], 'nom' => $compte['nom'], 'debut' => $maintenant, 'vu' => $maintenant];
        $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
        session_write_close();

        return null;
    }

    /* ---------- Espace commercial RGZ : identification par le login seul (pas de mot de passe) ---------- */

    /** @return array{cle: string, login: string, equipe: string, debut: int, vu: int}|null commercial identifié */
    public static function agent(): ?array
    {
        self::demarrer(true);
        $a = $_SESSION['agent'] ?? null;
        if (! is_array($a)) {
            return null;
        }
        $maintenant = time();
        if ($maintenant - $a['vu'] > self::reglage('inactivite_agent_minutes', 240) * 60 || $maintenant - $a['debut'] > self::reglage('duree_max_heures', 12) * 3600) {
            self::demarrer(false, false);   // sans Set-Cookie
            unset($_SESSION['agent']);
            session_write_close();

            return null;
        }
        if ($maintenant - $a['vu'] > self::REVERIFICATION) {
            self::demarrer(false, false);   // sans Set-Cookie
            $_SESSION['agent']['vu'] = $maintenant;
            session_write_close();
        }

        return $a;
    }

    /** @param array{cle: string, login: string, equipe: string} $infos */
    public static function connecterAgent(array $infos): void
    {
        self::demarrer();
        session_regenerate_id(true);
        self::$idCourant = session_id();
        $maintenant = time();
        $_SESSION['agent'] = ['cle' => $infos['cle'], 'login' => $infos['login'], 'equipe' => $infos['equipe'], 'debut' => $maintenant, 'vu' => $maintenant];
        $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
        session_write_close();
    }

    /** Saisies de login inconnues depuis cette IP : au-delà de 15 en 15 minutes, l'identification est suspendue. */
    public static function minutesDeBlocageAgent(): int
    {
        $fenetre = self::reglage('blocage_minutes', 15) * 60;
        $r = self::base(fn () => Db::first(
            "SELECT COUNT(*) AS n, MAX(`created_at`) AS dernier FROM `connexions_echouees` WHERE `ip` = ? AND `email` LIKE 'agent:%' AND `created_at` >= ?",
            [(string) ($_SERVER['REMOTE_ADDR'] ?? ''), date('Y-m-d H:i:s', time() - $fenetre)]
        ));

        return $r && (int) $r['n'] >= 15 ? max(1, (int) ceil(($fenetre - (time() - strtotime((string) $r['dernier']))) / 60)) : 0;
    }

    public static function noterEchecAgent(string $saisie): void
    {
        Db::insertGetId('connexions_echouees', ['email' => 'agent:'.mb_substr($saisie, 0, 180), 'ip' => (string) ($_SERVER['REMOTE_ADDR'] ?? ''), 'created_at' => Db::maintenant()]);
    }

    /** Crée les tables de connexion si besoin (première ouverture de la page) : les comptes peuvent alors être ajoutés dans phpMyAdmin. */
    public static function preparer(): void
    {
        self::base(fn () => Db::value('SELECT 1 FROM `admins` LIMIT 1'));
    }

    /**
     * Déconnecte UN rôle (« admin » ou « agent ») : l'administrateur et un commercial connectés dans le même navigateur
     * sont indépendants (se déconnecter de l'espace commercial ne coupe plus l'administration, et inversement).
     * La session n'est détruite (cookie effacé) que lorsqu'il ne reste plus personne de connecté. null : tout fermer.
     */
    public static function deconnecter(?string $role = null): void
    {
        if ($role !== null) {
            self::demarrer(false, false);
            unset($_SESSION[$role]);
            $restant = isset($_SESSION['admin']) || isset($_SESSION['agent']);
            if (session_status() === PHP_SESSION_ACTIVE) {
                session_write_close();
            }
            if ($restant) {
                return;
            }
        }
        self::demarrer();
        $_SESSION = [];
        session_destroy();
        self::$idCourant = '';
        unset($_COOKIE[self::COOKIE]);
        setcookie(self::COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'secure' => self::https(), 'httponly' => true, 'samesite' => 'Lax']);
    }

    /** Jeton anti-falsification des formulaires (connexion, déconnexion), créé à la demande. */
    public static function jeton(): string
    {
        self::demarrer(true);
        if (empty($_SESSION['csrf'])) {
            self::demarrer();
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            session_write_close();
        }

        return $_SESSION['csrf'];
    }

    /**
     * Formulaires de connexion / déconnexion : jeton valide, OU envoi depuis une page de ce site. Le jeton peut ne plus
     * correspondre sans aucune attaque (cookie remplacé par un autre onglet) ; un formulaire venu d'un AUTRE site reste refusé.
     */
    public static function formulaireValide(mixed $jeton): bool
    {
        return self::jetonValide($jeton) || self::memeOrigine();
    }

    public static function jetonValide(mixed $jeton): bool
    {
        self::demarrer(true);

        return is_string($jeton) && ! empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $jeton);
    }

    /** Requête d'écriture venue d'un autre site (en-tête Origin d'un autre domaine) : refusée par l'API. */
    public static function origineEtrangere(): bool
    {
        $origine = $_SERVER['HTTP_ORIGIN'] ?? null;

        return $origine !== null && $origine !== '' && parse_url($origine, PHP_URL_HOST) !== parse_url('//'.($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST);
    }

    /** @param array<string, mixed> $compte */
    private static function verifierMotDePasse(array $compte, string $motDePasse): bool
    {
        $stocke = (string) $compte['mot_de_passe'];
        $chiffre = password_get_info($stocke)['algoName'] !== 'unknown';
        $ok = $chiffre ? password_verify($motDePasse, $stocke) : hash_equals($stocke, $motDePasse);

        // Mot de passe encore en clair (saisi dans phpMyAdmin) ou empreinte d'un ancien algorithme : on le rechiffre
        if ($ok && (! $chiffre || password_needs_rehash($stocke, PASSWORD_DEFAULT))) {
            Db::executer('UPDATE `admins` SET `mot_de_passe` = ?, `updated_at` = ? WHERE `id` = ?', [password_hash($motDePasse, PASSWORD_DEFAULT), Db::maintenant(), $compte['id']]);
        }

        return $ok;
    }

    /** Minutes d'attente restantes : N échecs pour cet email depuis cette IP, ou 4N depuis cette IP (tous emails). */
    private static function minutesDeBlocage(string $email, string $ip): int
    {
        $max = self::reglage('tentatives_max', 5);
        $fenetre = self::reglage('blocage_minutes', 15) * 60;
        $depuis = date('Y-m-d H:i:s', time() - $fenetre);

        $r = self::base(fn () => Db::first(
            'SELECT SUM(`email` = ?) AS compte, COUNT(*) AS ip, MAX(`created_at`) AS dernier FROM `connexions_echouees` WHERE `ip` = ? AND `created_at` >= ?',
            [$email, $ip, $depuis]
        ));
        if (! $r || ((int) $r['compte'] < $max && (int) $r['ip'] < 4 * $max)) {
            return 0;
        }

        return max(1, (int) ceil(($fenetre - (time() - strtotime((string) $r['dernier']))) / 60));
    }

    /**
     * $lectureSeule : session lue puis refermée aussitôt (aucun verrou). $cookie = false : AUCUN en-tête Set-Cookie.
     * Les lectures et les prolongations n'envoient jamais de cookie : sinon la réponse tardive d'une requête partie AVANT
     * une déconnexion réinstallait l'ancien cookie par-dessus celui de la page de connexion (« La page a expiré »).
     * Sans cookie, une simple lecture ne crée pas de session.
     */
    private static function demarrer(bool $lectureSeule = false, bool $cookie = true): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        session_name(self::COOKIE);
        session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => self::https(), 'httponly' => true, 'samesite' => 'Lax']);
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_cookies', '1');
        ini_set('session.gc_maxlifetime', (string) (self::reglage('duree_max_heures', 12) * 3600));
        self::dossierSessions();

        // Identifiant à reprendre : celui ouvert plus tôt dans la requête (ex. juste après une connexion), sinon le cookie reçu
        $existant = self::$idCourant ?? (string) ($_COOKIE[self::COOKIE] ?? '');
        $valide = $existant !== '' && preg_match('/^[a-zA-Z0-9,-]{22,256}$/', $existant);
        if ($lectureSeule || ! $cookie) {
            if (! $valide) {
                $_SESSION = [];

                return;
            }
            ini_set('session.use_cookies', '0');
        }
        if ($valide) {
            session_id($existant);
        }
        session_start($lectureSeule ? ['read_and_close' => true] : []);
        if (! $lectureSeule) {
            self::$idCourant = session_id();
        }
    }

    /**
     * Sessions rangées dans storage/sessions : le nettoyage automatique du système (Ubuntu, nombreux hébergeurs) efface
     * sinon les sessions après 24 min sans tenir compte des durées de l'application. Nettoyage maison de temps en temps.
     */
    private static function dossierSessions(): void
    {
        static $fait = false;
        if ($fait) {
            return;
        }
        $fait = true;
        $d = dirname(__DIR__).'/storage/sessions';
        if ((! is_dir($d) && ! @mkdir($d, 0770, true)) || ! is_writable($d)) {
            return;   // dossier inaccessible : emplacement par défaut de PHP
        }
        session_save_path($d);
        if (random_int(1, 100) === 1) {
            $limite = time() - self::reglage('duree_max_heures', 12) * 3600;
            foreach (glob($d.'/sess_*') ?: [] as $f) {
                if (@filemtime($f) < $limite) {
                    @unlink($f);
                }
            }
        }
    }

    /** Formulaire envoyé depuis une page de l'application (en-tête Origin, ou Referer à défaut, du même site). */
    private static function memeOrigine(): bool
    {
        $source = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($source === '' || $source === 'null') {
            $source = $_SERVER['HTTP_REFERER'] ?? '';
        }
        $hote = parse_url($source, PHP_URL_HOST);

        return is_string($hote) && $hote !== '' && $hote === parse_url('//'.($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST);
    }

    private static function https(): bool
    {
        return (! empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    }

    private static function reglage(string $cle, int $defaut): int
    {
        return (int) Config::get('auth.'.$cle, $defaut);
    }

    /**
     * Requête SQL avec installation automatique des tables au premier lancement (comme l'API).
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
