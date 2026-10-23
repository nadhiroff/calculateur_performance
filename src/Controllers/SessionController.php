<?php

namespace App\Controllers;

use App\Auth;
use App\Http\Response;

/** Maintien de la session administrateur pendant que la page est utilisée (souris, clavier) sans appel à l'API. */
final class SessionController
{
    /** GET /api/session : prolonge la session (le contrôle d'accès de l'API l'a déjà vérifiée) ; 401 si elle a expiré. */
    public function maintenir(): Response
    {
        return Response::json(['inactivite_minutes' => Auth::inactiviteAdmin()]);
    }
}
