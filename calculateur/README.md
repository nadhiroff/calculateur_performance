# Calculateur Télécom — Celtiis / SBIN

Outil web **100 % navigateur** (HTML5 / CSS3 / JavaScript vanilla). Aucune base de données, aucun serveur, aucune installation.
Vous déposez le fichier Excel du jour, l'outil calcule en mémoire et vous partagez le rapport.

## Mise en route
- **Test local** : double-cliquez sur `index.html` (les valeurs par défaut sont embarquées dans `config/defaults.js`).
- **Hébergement** : copiez tout le dossier sur un hébergement statique (cPanel → `public_html`, Netlify « drag & drop », GitHub Pages, Vercel).
- Les bibliothèques (SheetJS, Chart.js, jsPDF, html2canvas, Font Awesome, polices) sont chargées depuis un CDN : une connexion Internet est nécessaire.

## Utilisation
1. **Tableau de bord** → *Importer les données* (glisser-déposer ou bouton) → *Analyser* → contrôle qualité → *Continuer*.
2. Naviguez : Tableau de bord, **Point du jour**, **Performance partenaires**. Le *jour de référence* (date) est modifiable.
3. La barre sticky du haut permet : Excel, PDF, CSV, WhatsApp, Gmail, Outlook, Partager (mobile), Copier le résumé, Imprimer, Export global.
4. **Paramètres** : objectifs par mois, règles de motivation, partenaires, sauvegarde JSON. Chaque modification recalcule automatiquement les rapports.

> **Partage** : WhatsApp, Gmail et Outlook s'ouvrent directement en ligne avec le titre et le résumé du rapport, **sans téléchargement forcé**.
> Sur mobile (et les navigateurs compatibles), WhatsApp et « Partager » utilisent le partage natif du système avec le fichier Excel ou PDF (liste « Partage natif »).
> Un lien web ne pouvant pas joindre de fichier, utilisez les boutons *Excel* / *PDF* si une pièce jointe est nécessaire.
> **Exports** : tous les fichiers Excel ont les en-têtes en gras sur fond gris (les lignes TOTAL en gras). Le CSV est du texte brut : aucune mise en forme n'y est possible.

## Version 3 — corrections
- Performance par login (One-Shot & commissions) fusionnée dans *Performance partenaires* ; l'ancienne vue du Dashboard est supprimée. Équipes et objectifs lus dans les paramètres (plus de devinette par le nom du login).
- Classement des partenaires : toutes les colonnes sont renseignées (rang, mois précédent, projection, écart, évolution, commission).
- Restauration de session fiabilisée : les lignes brutes et leurs en-têtes sont conservées (plus de colonnes perdues dans l'export « Données brutes »).
- Montants affichés sans « 0 FCFA » répétitif : l'unité est dans l'en-tête, un zéro s'affiche « 0 ».
- Point du jour › Agents : logins hors objectif masqués s'ils n'ont pas vendu ce jour-là, équipe « À préciser », réalisation « n/a » sans objectif.
- Objectifs jour / semaine : repris tels quels du fichier « OBJECTIFS TRACKING » (colonnes JOUR et SEM), sans aucun calcul ; modifiables à la main dans Paramètres › Objectifs.

## Filtre par période (Point du jour et Performance)
Les deux dates de la barre du haut s'appliquent aux **deux pages et à leurs exports** (Excel, PDF, CSV, résumé WhatsApp/e-mail) :
| Saisie | Point du jour | Performance |
|---|---|---|
| Rien | dernier jour du fichier | du 1er du mois au dernier jour |
| Date de fin seule | cette journée | du 1er du mois à cette date |
| Début + fin | ventes de la période ; objectif = objectif jour × jours ouvrés de la période ; primes = somme des journées réussies ; champion = agent le plus souvent champion | ventes de la période ; objectifs au prorata des jours ouvrés ; projection = rythme de la période sur le mois |
| Début = fin | cette journée | cette journée |
- Les objectifs étant mensuels, la période reste dans le mois de la date de fin (un début antérieur est ramené au 1er du mois, avec un message).
- Dates inversées : remises dans l'ordre automatiquement. Période sans jour ouvré (week-end) : ventes comptées, pas de taux ni de prime.
- La ligne sous les dates rappelle la période appliquée (nombre de jours, dont ouvrés).
- Vérifié sur FTTH.xlsx : totaux, partenaires et agents identiques à un recomptage indépendant ; période = somme des journées prises une à une.

## Règles de calcul retenues (conformes à vos fichiers)
| Sujet | Règle |
|---|---|
| Ventes | Seules les lignes `STATUS = OK` comptent. `VALIDE` = en attente, suivi à part. |
| B2B / B2C | B2B = `TYPE_CLIENT = ORGANISATION`, sinon B2C. |
| Objectif du jour | Valeur lue dans le fichier d'objectifs (colonnes JOUR / SEM), non calculée. |
| Partenaire | Lu dans le login `pvt_<jeton>_nom` (table modifiable). Sans jeton : règle par agence, sinon « AUTRES ». |
| RGZ | Partenaire prioritaire : épinglé et surligné partout, seul à avoir plan de motivation et objectifs. |
| Primes | Journée réussie 200 · Champion du jour 1 000 · Paliers TRO 80/100/120 % = 5 000/12 500/20 000 · Bonus B2B 5 000 · Superviseur : 500/jour, Bronze/Argent/Or 90/100/110 % = 15 000/30 000/50 000, activation ≥ 60 % d'agents à 80 %, trophée 50 000. Aucune prime les jours non ouvrés. |
| Commissions | One-shot 10 000 (B2C) / 12 000 (B2B), 80 % commercial / 20 % RGZ (ANONYMAT 100 % / 0 %). |
| CA | Somme de `MONTANT_TOTAL`, hors montants > 1 000 000 FCFA (case « Inclure les montants atypiques » au dashboard). |
| Logins | Normalisés (minuscules, `-` → `_`, suffixe `.ftth` ignoré) pour rapprocher fichier de souscriptions et fichier d'objectifs. |

## Hypothèses à confirmer
- Jetons `gieet`, `gieect`, `giect` rattachés à **EXPERT** ; `hima`/`him` à HIMALAYA, etc. → corrigez dans *Paramètres › Partenaires*.
- Les superviseurs ne figurent dans aucun fichier : colonne vide, à renseigner dans *Paramètres › Objectifs*.
- Écart avec votre Point du jour du 12/10 saisi à la main (45 ventes) : le fichier de souscriptions donne **47 ventes OK** pour RGZ (gkohla et cmerveille : 2 au lieu de 1).
- Logins hors objectifs (ex. `pvt_rgz_smireille.ftth`) : suivis, signalés dans les points d'attention, sans prime.

## Arborescence
```
index.php             application (Tableau de bord, Point du jour, Performance)
parametres.php        objectifs, règles, partenaires, sauvegarde
assets/css/           design-system, components, dashboard, print
assets/js/            utils, table, store, regles, objectifs, parser, calculs, dashboard,
                      point_jour, perf_partenaire, export, partage, parametres, app
config/               objectifs_defaut.json, regles_defaut.json, partenaires_defaut.json, schema.json,
                      defaults.js (copie embarquée utilisée par l'application)
```
`utils.js`, `table.js`, `store.js` et `partenaires_defaut.json` s'ajoutent à l'arborescence prévue (utilitaires, tableau triable sans jQuery, stockage commun, règles de rattachement des partenaires).

## Confidentialité
Le fichier est lu dans le navigateur et n'est ni envoyé ni stocké. Seuls les **paramètres** (objectifs, règles, partenaires) sont conservés dans le `localStorage` du navigateur, avec export/import JSON.
