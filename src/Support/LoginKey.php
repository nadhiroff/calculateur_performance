<?php

namespace App\Support;

/** Équivalent PHP exact de CT.cleLogin() (utils.js) : minuscules, « - » → « _ », suffixe « .ftth » retiré. */
final class LoginKey
{
    public static function from(?string $login): string
    {
        $l = mb_strtolower(trim((string) $login));
        $l = str_replace('-', '_', $l);

        return (string) preg_replace('/\.ftth$/', '', $l);
    }
}
