<?php

namespace App\Services;

use RuntimeException;

/** Fichier d'objectifs inexploitable : le message est affiché tel quel à l'utilisateur, « details » aide au diagnostic. */
class ObjectifsInvalidesException extends RuntimeException
{
    /** @param array<string, mixed> $details */
    public function __construct(string $message, public array $details = [])
    {
        parent::__construct($message);
    }
}
