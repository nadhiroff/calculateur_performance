<?php

namespace App\Http;

/** Réponse JSON. */
final class Response
{
    public function __construct(public readonly mixed $donnees, public readonly int $status = 200) {}

    public static function json(mixed $donnees, int $status = 200): self
    {
        return new self($donnees, $status);
    }

    /** Réponse JSON écrite au fil de l'eau par $ecrire (gros volumes : rien n'est gardé en mémoire). */
    public static function flux(\Closure $ecrire, int $status = 200): self
    {
        return new self($ecrire, $status);
    }

    public function envoyer(): void
    {
        if (! headers_sent()) {
            http_response_code($this->status);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-cache, private');
            header('X-Content-Type-Options: nosniff');
        }
        if ($this->donnees instanceof \Closure) {
            ($this->donnees)();

            return;
        }
        echo json_encode($this->donnees, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    }
}
