-- Credential rotation must not change imported meeting identity.
ALTER TABLE granola_sync_connections ADD COLUMN namespace UUID;
UPDATE granola_sync_connections SET namespace = id;
ALTER TABLE granola_sync_connections ALTER COLUMN namespace SET NOT NULL;
