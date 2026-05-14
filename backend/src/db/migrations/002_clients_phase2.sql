-- Phase 2: extender `clients` con contacto + webhook + activación + tags.
-- Migrations runner garantiza que este fichero solo se aplica una vez.

ALTER TABLE clients
  ADD COLUMN email VARCHAR(255) NULL AFTER name,
  ADD COLUMN phone VARCHAR(50) NULL AFTER email,
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER description,
  ADD COLUMN tags JSON NULL AFTER is_active,
  ADD COLUMN webhook_incoming_url VARCHAR(500) NULL AFTER tags,
  ADD COLUMN webhook_secret VARCHAR(255) NULL AFTER webhook_incoming_url;

CREATE INDEX idx_clients_is_active ON clients (is_active);
