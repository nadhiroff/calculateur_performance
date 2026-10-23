<?php

/*
|--------------------------------------------------------------------------
| API du calculateur — PHP natif (sans framework), compatible PHP 8.1+
|--------------------------------------------------------------------------
| Toutes les URL /api/... arrivent ici (réécriture dans api/.htaccess).
| Sans réécriture d'URL, /api/index.php/parametres et /api/index.php?route=parametres fonctionnent aussi.
*/

use App\Auth;
use App\Config;
use App\Controllers\AgentController;
use App\Controllers\ImportController;
use App\Controllers\ParametresController;
use App\Controllers\RegleController;
use App\Controllers\SessionController;
use App\Controllers\SouscriptionController;
use App\Controllers\SyntheseController;
use App\Http\HttpException;
use App\Http\Request;
use App\Http\Response;
use App\Installer;
use App\Journal;

require dirname(__DIR__).'/vendor/autoload.php';

date_default_timezone_set((string) Config::get('app.timezone', 'UTC'));
ini_set('display_errors', '0');
mb_internal_encoding('UTF-8');

/** Routes : [méthode, motif du chemin, [contrôleur, action]]. {mois} = segment d'URL passé à l'action. */
$routes = [
    // Paramètres : objectifs, règles, partenaires (tout est en base MySQL)
    ['GET', 'parametres', [ParametresController::class, 'show']],
    ['PUT', 'parametres', [ParametresController::class, 'update']],
    ['GET', 'objectifs', [ParametresController::class, 'objectifs']],

    // Règles de calcul (table calcul_rules)
    ['GET', 'regles', [RegleController::class, 'index']],
    ['GET', 'regles/{mois}', [RegleController::class, 'show']],
    ['PUT', 'regles/{mois}', [RegleController::class, 'update']],

    // Imports
    ['POST', 'imports/souscriptions', [ImportController::class, 'souscriptions']],
    ['POST', 'imports/objectifs', [ImportController::class, 'objectifs']],
    ['POST', 'imports/objectifs/confirmer', [ImportController::class, 'confirmerObjectifs']],

    // Consultation / filtrage / ajout manuel
    ['GET', 'souscriptions/periodes', [SouscriptionController::class, 'periodes']],
    ['GET', 'souscriptions', [SouscriptionController::class, 'index']],
    ['POST', 'souscriptions', [SouscriptionController::class, 'store']],

    // Vue d'ensemble (tableau de bord du Directeur)
    ['GET', 'synthese', [SyntheseController::class, 'show']],

    // Session administrateur prolongée tant que la page est utilisée
    ['GET', 'session', [SessionController::class, 'maintenir']],

    // Espace commercial RGZ : ses résultats et ceux de son équipe (commercial identifié ou administrateur)
    ['GET', 'agent/tableau', [AgentController::class, 'tableau']],
];

/** Trouve la route ; renvoie [action, paramètres] ou une réponse 404 / 405. */
$resoudre = static function (Request $request) use ($routes): array|Response {
    $methodesPermises = [];
    foreach ($routes as [$methode, $motif, $action]) {
        $regex = '#^'.preg_replace('#\{[a-z_]+\}#', '([^/]+)', $motif).'$#';
        if (! preg_match($regex, $request->chemin, $m)) {
            continue;
        }
        $methodesPermises[] = $methode;
        if ($methode === $request->methode || ($methode === 'GET' && $request->methode === 'HEAD')) {
            return [$action, array_slice($m, 1)];
        }
    }

    return $methodesPermises
        ? Response::json(['message' => 'Méthode '.$request->methode.' non autorisée pour cette adresse.'], 405)
        : Response::json(['message' => 'Adresse introuvable : /api/'.$request->chemin], 404);
};

$executer = static function (Request $request, array $action, array $params): Response {
    [$classe, $methode] = $action;

    // Imports : mémoire / durée relevées pour cette requête (post_max_size et upload_max_filesize : voir .user.ini)
    if (str_starts_with($request->chemin, 'imports/')) {
        @ini_set('memory_limit', (string) Config::get('uploads.memory_limit', '1024M'));
        @ini_set('max_execution_time', (string) Config::get('uploads.max_execution_time', 0));
        if (function_exists('set_time_limit')) {
            @set_time_limit((int) Config::get('uploads.max_execution_time', 0));
        }
        ignore_user_abort(true);   // un onglet fermé en cours d'import ne laisse pas un traitement à moitié fait
    }

    $controleur = new $classe();
    $reflexion = new ReflectionMethod($controleur, $methode);

    return $reflexion->getNumberOfParameters() > 0 && ($reflexion->getParameters()[0]->getType()?->getName() === Request::class)
        ? $controleur->$methode($request, ...$params)
        : $controleur->$methode(...$params);
};

/** Corps de requête rejeté par PHP (plus gros que post_max_size) : $_POST et $_FILES arrivent vides. */
$tropVolumineux = static function (): bool {
    $taille = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    $limite = ini_get('post_max_size');
    $octets = (int) $limite * match (strtoupper(substr((string) $limite, -1))) { 'G' => 1073741824, 'M' => 1048576, 'K' => 1024, default => 1 };

    return $octets > 0 && $taille > $octets;
};

$request = Request::capturer();

try {
    $routeAgent = str_starts_with($request->chemin, 'agent/');
    if (Auth::admin() === null && ! ($routeAgent && Auth::agent() !== null)) {
        // API réservée aux administrateurs connectés (calculateur/connexion.php) ; routes « agent/ » : aussi aux commerciaux (calculateur/espace.php)
        $reponse = Response::json(['message' => 'Session expirée ou absente : reconnectez-vous.'], 401);
    } elseif (! in_array($request->methode, ['GET', 'HEAD'], true) && Auth::origineEtrangere()) {
        $reponse = Response::json(['message' => 'Requête refusée : elle ne provient pas de l\'application.'], 403);
    } elseif ($request->methode === 'POST' && $tropVolumineux()) {
        $reponse = Response::json(['message' => 'Fichier trop volumineux pour la configuration PHP actuelle (post_max_size = '.ini_get('post_max_size')
            .', upload_max_filesize = '.ini_get('upload_max_filesize').'). Limite réglable dans le fichier .user.ini à la racine du site ou dans le panneau de l\'hébergeur.'], 413);
    } else {
        $route = $resoudre($request);
        if ($route instanceof Response) {
            $reponse = $route;
        } else {
            try {
                $reponse = $executer($request, ...$route);
            } catch (PDOException $e) {
                if (! Installer::tableManquante($e)) {
                    throw $e;
                }
                Installer::installer();   // premier lancement : tables créées, puis la requête est rejouée
                $reponse = $executer($request, ...$route);
            }
        }
    }
} catch (HttpException $e) {
    $corps = ['message' => $e->getMessage()];
    if ($e->errors) {
        $corps['errors'] = $e->errors;
    }
    $reponse = Response::json($corps, $e->status);
} catch (Throwable $e) {
    Journal::exception($e);
    $message = $e instanceof PDOException && in_array($e->errorInfo[1] ?? $e->getCode(), [1045, 1044, 1049, 2002, 2005], false)
        ? 'Connexion à la base de données impossible : vérifiez la section « db » de config/config.php.'
        : 'Erreur serveur.';
    $reponse = Response::json(Config::get('app.debug')
        ? ['message' => $message.' '.$e->getMessage(), 'exception' => get_class($e), 'file' => $e->getFile(), 'line' => $e->getLine()]
        : ['message' => $message], 500);
}

$reponse->envoyer();
