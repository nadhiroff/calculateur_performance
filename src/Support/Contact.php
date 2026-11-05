<?php

namespace App\Support;

use App\Config;

/**
 * Contact WhatsApp de la direction, affiché sur la page de connexion des commerciaux et dans leur espace.
 * Numéro modifiable dans config/config.php (contact.whatsapp), sinon celui ci-dessous.
 */
final class Contact
{
    private const WHATSAPP = '+22945789764';

    /** « +229 45 78 97 64 » */
    public static function whatsappAffiche(): string
    {
        $chiffres = self::chiffres();
        if (str_starts_with($chiffres, '229')) {
            return '+229 '.trim(chunk_split(substr($chiffres, 3), 2, ' '));
        }

        return '+'.$chiffres;
    }

    /** Lien qui ouvre la discussion WhatsApp, avec un message déjà écrit (le commercial n'a plus qu'à envoyer). */
    public static function whatsappLien(string $message = ''): string
    {
        return 'https://wa.me/'.self::chiffres().($message !== '' ? '?text='.rawurlencode($message) : '');
    }

    private static function chiffres(): string
    {
        return (string) preg_replace('/\D+/', '', (string) Config::get('contact.whatsapp', self::WHATSAPP));
    }
}
