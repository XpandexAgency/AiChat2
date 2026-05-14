-- =====================================================================
-- ChatBot · Schema inicial para Hostinger MySQL 8
-- =====================================================================
-- Cómo usarlo:
--   1) hPanel → Bases de Datos → MySQL → crea la BD (anota nombre + user).
--   2) Abre phpMyAdmin de esa BD → pestaña "SQL" → pega este script → Continuar.
--   3) Pon en backend/.env las credenciales DB_* + ADMIN_BOOTSTRAP_*.
--   4) Restart de la app Node en hPanel.
--      → El bootstrap crea el primer admin con ADMIN_BOOTSTRAP_EMAIL/PASSWORD
--        del .env si la tabla `admins` está vacía.
--
-- Nota: este archivo es idempotente (CREATE TABLE IF NOT EXISTS). Marca
-- las migraciones 001 y 002 como aplicadas en `migrations_applied` para
-- que el runner del backend no intente re-ejecutar las ALTER de la 002.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Admins (login del panel)
CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sesiones activas (token_hash = sha256 del cookie raw, nunca se guarda raw)
CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `token_hash` CHAR(64) NOT NULL,
  `admin_id` INT NOT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token_hash`),
  KEY `idx_admin_id` (`admin_id`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `admin_sessions_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clientes (usuarios finales, gestionados por admins; pool compartido)
CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(50) DEFAULT NULL,
  `description` TEXT,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `tags` JSON DEFAULT NULL,
  `webhook_incoming_url` VARCHAR(500) DEFAULT NULL,
  `webhook_secret` VARCHAR(255) DEFAULT NULL,
  `created_by` INT DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_clients_is_active` (`is_active`),
  CONSTRAINT `clients_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sesiones de WhatsApp (una por número, perteneciente a un cliente)
CREATE TABLE IF NOT EXISTS `wa_sessions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `client_id` INT NOT NULL,
  `session_id` VARCHAR(255) NOT NULL,
  `status` VARCHAR(50) DEFAULT NULL,
  `phone_number` VARCHAR(20) DEFAULT NULL,
  `qr_data_url` LONGTEXT,
  `last_error` TEXT,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_id` (`session_id`),
  KEY `idx_client_id` (`client_id`),
  KEY `idx_session_id` (`session_id`),
  CONSTRAINT `wa_sessions_ibfk_1` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit log
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `admin_id` INT DEFAULT NULL,
  `action` VARCHAR(100) NOT NULL,
  `resource_type` VARCHAR(100) DEFAULT NULL,
  `resource_id` VARCHAR(255) DEFAULT NULL,
  `details` JSON DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` TEXT,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_id` (`admin_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_action` (`action`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tracker de migraciones (el backend usa esto para no re-ejecutar)
CREATE TABLE IF NOT EXISTS `migrations_applied` (
  `filename` VARCHAR(255) NOT NULL,
  `applied_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Marcamos las migraciones del repo como aplicadas para que el runner no
-- intente re-ejecutar las ALTER de la 002 (fallaría: columna ya existe).
INSERT IGNORE INTO `migrations_applied` (`filename`) VALUES
  ('001_init.sql'),
  ('002_clients_phase2.sql');

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- FIN. El primer admin se crea automáticamente al arrancar el backend
-- si ADMIN_BOOTSTRAP_EMAIL y ADMIN_BOOTSTRAP_PASSWORD están en el .env.
-- =====================================================================
