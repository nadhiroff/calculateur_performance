<?php

namespace App\Controllers;

use App\Auth;
use App\Db;
use App\Http\HttpException;
use App\Http\Request;
use App\Http\Response;
use App\Http\Valider;
use App\Services\AgentTableau;
use App\Services\PeriodeDefaut;
use App\Support\Cache;
use App\Support\LoginKey;

/** Espace commercial RGZ (calculateur/mon-espace.php). */
final class AgentController
{
    /** GET /api/agent/session : session toujours valide (le contrôle d'accès de l'API a déjà vérifié le code) ; 401 sinon. */
    public function session(): Response
    {
        return Response::json(['ok' => true]);
    }

    /**
     * GET /api/agent/tableau[?du=AAAA-MM-JJ&au=AAAA-MM-JJ]
     * Commercial identifié : SES résultats et ceux de SON équipe. Administrateur : aperçu de n'importe quel login (?login=).
     * Sans dates : période par défaut commune (PeriodeDefaut : dernier mois ayant un jour ouvré avec des données).
     */
    public function tableau(Request $request): Response
    {
        $agent = Auth::agent();
        $cle = $agent['cle'] ?? (Auth::admin() !== null && $request->filled('login') ? LoginKey::from((string) $request->input('login')) : null);
        if ($cle === null) {
            return Response::json(['message' => 'Session expirée : identifiez-vous à nouveau.'], 401);
        }

        $bornes = Cache::memoriser('bornes:'.Cache::version(), 600, static fn () => Db::first('SELECT MIN(`jour`) AS du, MAX(`jour`) AS au FROM `celtiis_datas`') ?? []);
        $dernier = $bornes['au'] ?? date('Y-m-d');
        // Sans dates : même période par défaut que l'administration (dernier mois ayant un jour ouvré avec des données)
        $defaut = PeriodeDefaut::calculer();
        $au = Valider::date($request, 'au') ?? ($defaut['au'] ?? $dernier);
        $du = Valider::date($request, 'du') ?? (Valider::date($request, 'au') !== null || $defaut === null ? substr($au, 0, 7).'-01' : $defaut['du']);
        if ($du > $au) {
            [$du, $au] = [$au, $du];
        }
        if ((strtotime($au) - strtotime($du)) / 86400 >= AgentTableau::PERIODE_MAX) {
            throw HttpException::validation('du', 'Période trop longue : '.AgentTableau::PERIODE_MAX.' jours au maximum.');
        }

        // Tableau complet du commercial gardé 10 min (renouvelé à chaque import) : un rechargement de page ne recalcule rien.
        // v6 : champion de l'équipe, mois précédent compté avec ses propres règles (anciennes réponses en cache ignorées)
        $tableau = Cache::memoriser('agent-v6:'.$cle.':'.$du.':'.$au.':'.Cache::version(), 600, static fn () => (new AgentTableau())->calculer($cle, $du, $au));

        return Response::json($tableau + [
            'donnees' => ['du' => $bornes['du'] ?? null, 'au' => $dernier],
        ]);
    }
}
