-- Phase 4: pairing token público para que el cliente final escanee el QR
-- sin necesitar login. URL: https://aichat.xpandex.es/connect/<token>

ALTER TABLE clients
  ADD COLUMN pairing_token CHAR(64) NULL AFTER webhook_secret,
  ADD UNIQUE INDEX uniq_pairing_token (pairing_token);

-- Para clientes ya existentes generamos un token determinístico-pero-único
-- combinando SHA2 + UUID. El backend ofrece un endpoint "regenerar" si se
-- necesita rotar.
UPDATE clients
SET pairing_token = SHA2(CONCAT(UUID(), RAND(), id, name), 256)
WHERE pairing_token IS NULL;
