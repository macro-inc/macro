SET LOCAL lock_timeout = '5s';

ALTER TABLE hosted_runtime
    ADD COLUMN vcpus INTEGER NOT NULL DEFAULT 4 CHECK (vcpus > 0),
    ADD COLUMN memory_gib INTEGER NOT NULL DEFAULT 8 CHECK (memory_gib > 0),
    ADD COLUMN disk_gib INTEGER NOT NULL DEFAULT 100 CHECK (disk_gib > 0),
    ADD COLUMN catalog_entry TEXT NOT NULL DEFAULT 'standard@2026-11',
    ADD COLUMN price_id TEXT;

-- Snapshot the original size specifications, never a future purchase catalog.
-- The original schema did not persist Stripe prices. Mark those rows explicitly
-- so their missing historical prices can be backfilled before billing resumes.
UPDATE hosted_runtime
SET vcpus = CASE size WHEN 'standard' THEN 4 WHEN 'large' THEN 8 WHEN 'xl' THEN 16 END,
    memory_gib = CASE size WHEN 'standard' THEN 8 WHEN 'large' THEN 16 WHEN 'xl' THEN 32 END,
    disk_gib = CASE size WHEN 'standard' THEN 100 WHEN 'large' THEN 200 WHEN 'xl' THEN 400 END,
    catalog_entry = size || '@legacy-2026-11';

ALTER TABLE hosted_runtime
    DROP COLUMN units,
    ADD CONSTRAINT hosted_runtime_price_provenance_check CHECK (
        (price_id IS NULL) = (state->>'comp_reason' IS NOT NULL)
        OR (price_id IS NULL AND catalog_entry IN (
            'standard@legacy-2026-11', 'large@legacy-2026-11', 'xl@legacy-2026-11'
        ))
    );
