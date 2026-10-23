<?php

namespace App\Controllers;

use App\Http\HttpException;
use App\Http\Request;
use App\Http\Response;
use App\Http\Valider;
use App\Models\AppSetting;
use App\Models\CalcRule;
use stdClass;

/** Règles de calcul lues / écrites directement dans la table calcul_rules. */
final class RegleController
{
    /** GET /api/regles → mois disponibles + configuration partenaires. */
    public function index(): Response
    {
        return Response::json(['mois' => CalcRule::moisDisponibles(), 'partenaires' => CalcRule::partenaires() ?? new stdClass()]);
    }

    /** GET /api/regles/2026-10 → règles du mois (même forme que regles_defaut.json). 404 si le mois n'a pas de règles. */
    public function show(Request $request, string $mois): Response
    {
        $this->verifierMois($mois);
        $regles = CalcRule::pourMois($mois);
        if ($regles === null) {
            return Response::json(['message' => "Aucune règle enregistrée pour $mois.", 'mois_disponibles' => CalcRule::moisDisponibles()], 404);
        }

        return Response::json(['mois' => $mois, 'source' => 'base', 'regles' => $regles]);
    }

    /** PUT /api/regles/2026-10  (corps JSON = règles du mois). Écrit par upsert (mois, cle) et incrémente la version des paramètres. */
    public function update(Request $request, string $mois): Response
    {
        $this->verifierMois($mois);
        foreach (['agent', 'superviseur'] as $champ) {
            if (! is_array($request->input($champ)) || $request->input($champ) === []) {
                throw HttpException::validation($champ, "Le champ $champ est obligatoire.");
            }
        }

        $regles = json_decode($request->contenu());   // objets : les {} vides sont préservés
        if (! $regles instanceof stdClass) {
            return Response::json(['message' => 'Corps JSON invalide.'], 422);
        }
        CalcRule::ecrireMois($mois, $regles);
        $version = AppSetting::incrementerVersion();

        return Response::json(['mois' => $mois, 'version' => $version, 'regles' => CalcRule::pourMois($mois)]);
    }

    private function verifierMois(string $mois): void
    {
        if (! preg_match(Valider::MOIS, $mois)) {
            throw new HttpException(422, 'Le mois doit être au format AAAA-MM.');
        }
    }
}
