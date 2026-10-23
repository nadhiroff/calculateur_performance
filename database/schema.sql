-- =====================================================================================
-- Calculateur de performance — schéma MySQL / MariaDB
-- Créé AUTOMATIQUEMENT au premier appel de l'API si les tables manquent (voir src/Installer.php).
-- Peut aussi être importé à la main dans phpMyAdmin. Sans risque : « IF NOT EXISTS » ne touche jamais aux données existantes.
-- Tables identiques à celles de l'ancienne version Laravel : une base déjà remplie est reprise telle quelle.
-- =====================================================================================

-- Journal de chaque import : traçabilité + court-circuit si le MÊME fichier (SHA-256) est redéposé.
CREATE TABLE IF NOT EXISTS `imports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `type` varchar(30) NOT NULL,
  `nom_fichier` varchar(255) NOT NULL,
  `file_hash` char(64) NOT NULL,
  `statut` varchar(20) NOT NULL DEFAULT 'en_cours',
  `mois` char(7) DEFAULT NULL,
  `stats` json DEFAULT NULL,
  `erreur` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `imports_type_file_hash_index` (`type`, `file_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Paramètres globaux clé/valeur (version optimiste des paramètres, confirmations d'import en attente).
CREATE TABLE IF NOT EXISTS `app_settings` (
  `cle` varchar(60) NOT NULL,
  `valeur` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`cle`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Souscriptions Celtiis. Clé métier unique : (date_commande, id_client, msisdn).
CREATE TABLE IF NOT EXISTS `celtiis_datas` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `date_commande` datetime NOT NULL,
  `id_client` varchar(40) NOT NULL,
  `msisdn` varchar(40) NOT NULL DEFAULT '',
  `code` varchar(40) DEFAULT NULL,
  `type_client` varchar(20) DEFAULT NULL,
  `client_nom` varchar(255) DEFAULT NULL,
  `statut` varchar(20) NOT NULL,
  `nom_offre` varchar(255) DEFAULT NULL,
  `montant_total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `agence` varchar(120) DEFAULT NULL,
  `login_vendeur` varchar(120) DEFAULT NULL,
  `login_key` varchar(120) DEFAULT NULL,
  `nom_vendeur` varchar(120) DEFAULT NULL,
  `date_provisioning` datetime DEFAULT NULL,
  `date_update` datetime DEFAULT NULL,
  `source` varchar(10) NOT NULL DEFAULT 'import',
  `raw` json DEFAULT NULL,
  `row_hash` char(64) NOT NULL,
  `import_id` bigint unsigned DEFAULT NULL,
  `last_import_id` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `jour` date GENERATED ALWAYS AS (DATE(`date_commande`)) STORED,
  `mois` char(7) GENERATED ALWAYS AS (CONCAT(YEAR(`date_commande`), '-', LPAD(MONTH(`date_commande`), 2, '0'))) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `celtiis_datas_cle_unique` (`date_commande`, `id_client`, `msisdn`),
  KEY `celtiis_datas_import_id_foreign` (`import_id`),
  KEY `celtiis_datas_last_import_id_foreign` (`last_import_id`),
  KEY `celtiis_datas_jour_index` (`jour`),
  KEY `celtiis_datas_mois_statut_index` (`mois`, `statut`),
  KEY `celtiis_datas_login_key_index` (`login_key`),
  KEY `celtiis_datas_type_client_index` (`type_client`),
  KEY `celtiis_datas_agence_index` (`agence`),
  CONSTRAINT `celtiis_datas_import_id_foreign` FOREIGN KEY (`import_id`) REFERENCES `imports` (`id`) ON DELETE SET NULL,
  CONSTRAINT `celtiis_datas_last_import_id_foreign` FOREIGN KEY (`last_import_id`) REFERENCES `imports` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un enregistrement par mois « AAAA-MM » : calendrier, commissions (objectifs hors équipes).
CREATE TABLE IF NOT EXISTS `mensual_settings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `mois` char(7) NOT NULL,
  `objectifs_meta` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mensual_settings_mois_unique` (`mois`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Objectifs mensuels : une ligne par ÉQUIPE et une ligne par LOGIN et par mois.
CREATE TABLE IF NOT EXISTS `mensual_objectives` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `mois` char(7) NOT NULL,
  `niveau` varchar(10) NOT NULL,
  `cle` varchar(120) NOT NULL,
  `equipe` varchar(80) NOT NULL,
  `login` varchar(120) DEFAULT NULL,
  `superviseur` varchar(120) DEFAULT NULL,
  `segment` varchar(40) DEFAULT NULL,
  `position` int unsigned NOT NULL DEFAULT 0,
  `obj_b2c` int unsigned NOT NULL DEFAULT 0,
  `obj_b2b` int unsigned NOT NULL DEFAULT 0,
  `obj_jour` decimal(10,2) DEFAULT NULL,
  `obj_semaine` decimal(10,2) DEFAULT NULL,
  `part_rgz` decimal(6,4) DEFAULT NULL,
  `primes` tinyint(1) NOT NULL DEFAULT 1,
  `extra` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mensual_objectives_cle_unique` (`mois`, `niveau`, `cle`),
  KEY `mensual_objectives_mois_equipe_index` (`mois`, `equipe`),
  CONSTRAINT `mensual_objectives_mois_foreign` FOREIGN KEY (`mois`) REFERENCES `mensual_settings` (`mois`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Règles de calcul : une ligne par mois et par groupe de règles (mois = 'global' → configuration partenaires).
CREATE TABLE IF NOT EXISTS `calcul_rules` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `mois` varchar(7) NOT NULL,
  `cle` varchar(80) NOT NULL,
  `valeur` json NOT NULL,
  `position` smallint unsigned NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `calcul_rules_cle_unique` (`mois`, `cle`),
  KEY `calcul_rules_mois_index` (`mois`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Administrateurs autorisés à se connecter. Comptes ajoutés à la main dans phpMyAdmin :
--   INSERT INTO admins (email, mot_de_passe, nom) VALUES ('prenom@rgz.bj', 'MotDePasseProvisoire', 'Prénom NOM');
-- Un mot de passe saisi en clair est remplacé par son empreinte (password_hash) dès la première connexion réussie.
CREATE TABLE IF NOT EXISTS `admins` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(190) NOT NULL,
  `mot_de_passe` varchar(255) NOT NULL,
  `nom` varchar(120) DEFAULT NULL,
  `actif` tinyint(1) NOT NULL DEFAULT 1,
  `derniere_connexion` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `admins_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Administrateur initial. INSERT IGNORE : sans effet si le compte existe déjà (ce fichier peut être rejoué sans risque).
-- Mot de passe en clair, chiffré automatiquement à la première connexion. À CHANGER sur l'hébergement :
--   UPDATE admins SET mot_de_passe = 'UnVraiMotDePasse' WHERE email = 'rgz@rgz.bj';
INSERT IGNORE INTO `admins` (`email`, `mot_de_passe`, `nom`) VALUES ('rgz@rgz.bj', 'Admin', 'RGZ');

-- Tentatives de connexion échouées (blocage temporaire contre les essais de mots de passe en série).
CREATE TABLE IF NOT EXISTS `connexions_echouees` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(190) NOT NULL,
  `ip` varchar(45) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `connexions_echouees_email_ip_index` (`email`, `ip`, `created_at`),
  KEY `connexions_echouees_ip_index` (`ip`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
