<?php

namespace App\Models;

use App\Db;

/** Journal des imports (table imports). Les lignes sont des tableaux, « stats » décodé. */
final class Import
{
    /** @param array<string, mixed> $attrs */
    public static function creer(array $attrs): int
    {
        $now = Db::maintenant();

        return Db::insertGetId('imports', self::encoder($attrs) + ['created_at' => $now, 'updated_at' => $now]);
    }

    /** @param array<string, mixed> $attrs */
    public static function modifier(int $id, array $attrs): void
    {
        $attrs = self::encoder($attrs) + ['updated_at' => Db::maintenant()];
        $set = implode(', ', array_map(static fn (string $c) => "`$c` = ?", array_keys($attrs)));
        Db::executer("UPDATE `imports` SET $set WHERE `id` = ?", [...array_values($attrs), $id]);
    }

    /**
     * Imports restés « en_cours » depuis plus de $minutes : le processus PHP a été tué par l'hébergeur (mémoire ou durée)
     * sans pouvoir rien signaler. Rien n'a été écrit (transaction annulée à la coupure) : on les passe en échec.
     */
    public static function marquerInterrompus(string $type, int $minutes): void
    {
        Db::executer(
            "UPDATE `imports` SET `statut` = 'echec', `erreur` = ?, `updated_at` = ? WHERE `type` = ? AND `statut` = 'en_cours' AND `created_at` < ?",
            ['Import interrompu par l\'hébergeur (limite de mémoire ou de durée dépassée). Aucune ligne n\'a été enregistrée.', Db::maintenant(), $type, date('Y-m-d H:i:s', time() - $minutes * 60)]
        );
    }

    /** @return array<string, mixed>|null dernier import réussi de ce fichier exact */
    public static function dejaImporte(string $type, string $hash): ?array
    {
        return self::decoder(Db::first("SELECT * FROM `imports` WHERE `type` = ? AND `file_hash` = ? AND `statut` = 'ok' ORDER BY `id` DESC LIMIT 1", [$type, $hash]));
    }

    /** @return array<string, mixed>|null */
    public static function dernierReussi(string $type): ?array
    {
        return self::decoder(Db::first("SELECT * FROM `imports` WHERE `type` = ? AND `statut` = 'ok' ORDER BY `id` DESC LIMIT 1", [$type]));
    }

    /**
     * Derniers imports pour le journal. Un échec n'y reste que tant qu'aucun import du même type n'a réussi après lui :
     * une fois le problème réglé, il n'encombre plus l'affichage (il reste en base pour la traçabilité).
     *
     * @return array<int, array<string, mixed>>
     */
    public static function derniers(int $n): array
    {
        return array_map([self::class, 'decoder'], Db::select(
            "SELECT i.`id`, i.`type`, i.`nom_fichier`, i.`statut`, i.`stats`, i.`erreur`, i.`created_at` FROM `imports` i"
            ." WHERE NOT (i.`statut` = 'echec' AND EXISTS (SELECT 1 FROM `imports` o WHERE o.`type` = i.`type` AND o.`statut` = 'ok' AND o.`id` > i.`id`))"
            .' ORDER BY i.`id` DESC LIMIT '.max(1, $n)
        ));
    }

    /**
     * @param  array<string, mixed>|null  $r
     * @return array<string, mixed>|null
     */
    public static function decoder(?array $r): ?array
    {
        if ($r !== null && array_key_exists('stats', $r)) {
            $r['stats'] = $r['stats'] === null ? null : json_decode((string) $r['stats'], true);
        }

        return $r;
    }

    /**
     * @param  array<string, mixed>  $attrs
     * @return array<string, mixed>
     */
    private static function encoder(array $attrs): array
    {
        if (array_key_exists('stats', $attrs) && $attrs['stats'] !== null) {
            $attrs['stats'] = json_encode($attrs['stats'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        return $attrs;
    }
}
