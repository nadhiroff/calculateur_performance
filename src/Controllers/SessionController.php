<?php

namespace App\Controllers;

use App\Auth;
use App\Http\Request;
use App\Http\Response;

/** Maintien de la session administrateur pendant que la page est utilisée (souris, clavier) sans appel à l'API. */
final class SessionController
{
    /** GET /api/session : prolonge la session (le contrôle d'accès de l'API l'a déjà vérifiée) ; 401 si elle a expiré. */
    public function maintenir(): Response
    {
        return Response::json(['inactivite_minutes' => Auth::inactiviteAdmin()]);
    }

    /** POST /api/session/menu {groupes: string[]} : groupes du menu ouverts, rouverts à l'actualisation de la page. */
    public function menu(Request $request): Response
    {
        $g = $request->input('groupes', []);
        Auth::enregistrerMenuAdmin(is_array($g) ? array_slice($g, 0, 20) : []);

        return Response::json(['ok' => true]);
    }
}
