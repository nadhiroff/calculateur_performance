<?php

namespace App\Controllers;

use App\Auth;
use App\Http\HttpException;
use App\Http\Request;
use App\Http\Response;
use App\Services\AgentCode;
use App\Support\LoginKey;

/** Paramètres › Utilisateurs : codes à 4 chiffres des commerciaux RGZ (administrateurs seulement, voir api/index.php). */
final class UtilisateurController
{
    /** GET /api/utilisateurs : tous les commerciaux RGZ des objectifs, avec l'état de leur code. */
    public function index(): Response
    {
        // Dates en ISO 8601 (heures de la base en UTC, comme SouscriptionController) : le navigateur les affiche à l'heure locale
        $iso = static fn (?string $sql): ?string => $sql === null ? null : date('c', (int) strtotime($sql.' UTC'));
        $liste = array_map(static fn (array $u) => ['cree_le' => $iso($u['cree_le']), 'derniere_connexion' => $iso($u['derniere_connexion']), 'reinit_le' => $iso($u['reinit_le'])] + $u, AgentCode::liste());

        return Response::json([
            'utilisateurs' => $liste,
            'total' => count($liste),
            'avec_code' => count(array_filter($liste, static fn (array $u) => $u['code'])),
        ]);
    }

    /** POST /api/utilisateurs/reinitialiser {cle} : efface le code ; le commercial en choisira un nouveau. */
    public function reinitialiser(Request $request): Response
    {
        $cle = LoginKey::from((string) $request->input('cle', ''));
        if ($cle === '') {
            throw HttpException::validation('cle', 'Login manquant.');
        }
        $avait = AgentCode::lire($cle) !== null;
        AgentCode::reinitialiser($cle, (string) (Auth::admin()['email'] ?? 'administrateur'));

        return Response::json(['cle' => $cle, 'avait_code' => $avait]);
    }
}
