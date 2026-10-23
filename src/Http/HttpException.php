<?php

namespace App\Http;

use RuntimeException;

/** Erreur à renvoyer telle quelle au navigateur : { message, errors? } avec le code HTTP donné. */
final class HttpException extends RuntimeException
{
    /** @param array<string, string[]> $errors */
    public function __construct(public readonly int $status, string $message, public readonly array $errors = [])
    {
        parent::__construct($message);
    }

    /** Erreur de validation 422 sur un champ (même forme que l'ancienne API : errors.champ = [message]). */
    public static function validation(string $champ, string $message): self
    {
        return new self(422, $message, [$champ => [$message]]);
    }
}
