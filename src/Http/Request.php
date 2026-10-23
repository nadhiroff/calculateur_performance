<?php

namespace App\Http;

/** Requête HTTP courante : méthode, chemin relatif à /api, paramètres GET, corps JSON ou formulaire, fichiers. */
final class Request
{
    /** @var array<string, mixed>|null */
    private ?array $json = null;

    private ?string $contenu = null;

    public function __construct(public readonly string $methode, public readonly string $chemin) {}

    public static function capturer(): self
    {
        $methode = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        if ($methode === 'POST' && isset($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) {
            $methode = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']);
        }

        return new self($methode, self::cheminApi());
    }

    /**
     * Chemin demandé, relatif au dossier api/ : « /api/regles/2026-10?x=1 » → « regles/2026-10 ».
     * Fonctionne avec la réécriture d'URL (.htaccess) comme sans (api/index.php/regles/2026-10 ou api/index.php?route=regles).
     */
    private static function cheminApi(): string
    {
        if (isset($_GET['route']) && is_string($_GET['route'])) {
            return trim($_GET['route'], '/');
        }
        if (! empty($_SERVER['PATH_INFO'])) {
            return trim((string) $_SERVER['PATH_INFO'], '/');
        }
        $uri = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
        $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
        foreach ([$script, dirname($script)] as $base) {
            if ($base !== '' && $base !== '/' && str_starts_with($uri, $base)) {
                return trim(substr($uri, strlen($base)), '/');
            }
        }

        return trim($uri, '/');
    }

    public function contenu(): string
    {
        return $this->contenu ??= (string) file_get_contents('php://input');
    }

    public function estJson(): bool
    {
        return str_contains(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'json');
    }

    /** @return array<string, mixed> corps JSON décodé en tableaux (vide si le corps n'est pas du JSON) */
    public function json(): array
    {
        if ($this->json === null) {
            $d = $this->estJson() ? json_decode($this->contenu(), true) : null;
            $this->json = is_array($d) ? $d : [];
        }

        return $this->json;
    }

    /** Valeur d'entrée : corps JSON, puis formulaire (POST), puis paramètres d'URL. */
    public function input(string $cle, mixed $defaut = null): mixed
    {
        $json = $this->json();
        if (array_key_exists($cle, $json)) {
            return $json[$cle];
        }
        if (array_key_exists($cle, $_POST)) {
            return $_POST[$cle];
        }

        return $_GET[$cle] ?? $defaut;
    }

    /** Présent et non vide (null, '' et [] comptent comme absents). */
    public function filled(string $cle): bool
    {
        $v = $this->input($cle);

        return ! ($v === null || $v === '' || $v === []);
    }

    public function query(string $cle): mixed
    {
        return $_GET[$cle] ?? null;
    }

    /** « 1 », « true », « on », « yes » → true. */
    public function boolean(string $cle): bool
    {
        return filter_var($this->input($cle, false), FILTER_VALIDATE_BOOLEAN);
    }

    /** @return array{name: string, type: string, tmp_name: string, error: int, size: int}|null */
    public function fichier(string $cle): ?array
    {
        $f = $_FILES[$cle] ?? null;

        return is_array($f) && is_string($f['name'] ?? null) ? $f : null;
    }
}
