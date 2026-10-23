<?php

namespace App\Controllers;

use App\Http\HttpException;
use App\Http\Request;
use App\Http\Response;
use App\Http\Valider;
use App\Models\AppSetting;
use App\Models\MensualObjective;
use App\Services\HistoriqueVentes;
use App\Services\ParametresSync;

final class ParametresController
{
    /** GET /api/parametres → { vide, version, etat } ; « etat » a la forme exacte de l'état du front (règles lues dans calcul_rules). */
    public function show(): Response
    {
        $etat = (new ParametresSync())->exporter();
        // Historique mensuel par partenaire : mois présents en base calculés à partir des ventes réelles (HistoriqueVentes)
        if ($etat !== null && is_object($etat['partenaires']) && isset($etat['partenaires']->historique)) {
            $etat['partenaires']->historique = HistoriqueVentes::completer($etat['partenaires']);
        }

        return Response::json(['vide' => $etat === null, 'version' => AppSetting::version(), 'etat' => $etat]);
    }

    /**
     * PUT /api/parametres  { etat, base_version }
     * Remplace l'état complet. base_version = verrou optimiste : si quelqu'un d'autre a enregistré entre-temps → 409.
     */
    public function update(Request $request): Response
    {
        // « Obligatoire » = présent ET non vide (un tableau vide est refusé, comme dans l'ancienne version)
        $rempli = static fn (mixed $v): bool => is_array($v) && $v !== [];

        $etat = $request->input('etat');
        if (! $rempli($etat)) {
            throw HttpException::validation('etat', 'Le champ etat est obligatoire.');
        }
        if (! in_array($etat['version'] ?? null, [1, '1'], true)) {
            throw HttpException::validation('etat.version', 'Le champ etat.version doit valoir 1.');
        }
        if (! $rempli($etat['periodes'] ?? null)) {
            throw HttpException::validation('etat.periodes', 'Le champ etat.periodes doit contenir au moins un mois.');
        }
        foreach ($etat['periodes'] as $mois => $p) {
            if (! $rempli($p['objectifs']['equipes'] ?? null)) {
                throw HttpException::validation("etat.periodes.$mois.objectifs.equipes", "Le champ etat.periodes.$mois.objectifs.equipes est obligatoire.");
            }
            if (! $rempli($p['regles'] ?? null)) {
                throw HttpException::validation("etat.periodes.$mois.regles", "Le champ etat.periodes.$mois.regles est obligatoire.");
            }
        }
        if (array_key_exists('partenaires', $etat) && ! is_array($etat['partenaires'])) {
            throw HttpException::validation('etat.partenaires', 'Le champ etat.partenaires doit être un objet.');
        }
        $baseVersion = $request->input('base_version');
        if ($baseVersion !== null && filter_var($baseVersion, FILTER_VALIDATE_INT) === false) {
            throw HttpException::validation('base_version', 'Le champ base_version doit être un entier.');
        }

        foreach (array_keys($etat['periodes']) as $mois) {
            if (! preg_match(Valider::MOIS, (string) $mois)) {
                return Response::json(['message' => "Clé de mois invalide : $mois"], 422);
            }
        }
        $courante = AppSetting::version();
        if ($request->filled('base_version') && (int) $baseVersion !== $courante) {
            return Response::json(['message' => 'Les paramètres ont été modifiés ailleurs.', 'version' => $courante], 409);
        }

        // Même corps décodé EN OBJETS : les règles et partenaires gardent leurs {} vides (voir CalcRule)
        $brut = json_decode($request->contenu());
        // « auto » (mois calculés depuis la base) est recalculé à chaque lecture : jamais enregistré
        unset($etat['partenaires']['historique']['auto']);
        if (isset($brut->etat->partenaires->historique->auto)) {
            unset($brut->etat->partenaires->historique->auto);
        }

        return Response::json(['version' => (new ParametresSync())->importer($etat, $brut->etat ?? null)]);
    }

    /** GET /api/objectifs?mois=2026-10&niveau=login&equipe=YANKEE → consultation / filtrage à plat. */
    public function objectifs(Request $request): Response
    {
        $f = [
            'mois' => Valider::mois($request, 'mois'),
            'niveau' => Valider::parmi($request, 'niveau', ['equipe', 'login']),
            'equipe' => Valider::texte($request, 'equipe'),
        ];

        return Response::json(MensualObjective::lister($f));
    }
}
