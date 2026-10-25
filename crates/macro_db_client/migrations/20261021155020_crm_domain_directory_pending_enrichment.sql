-- A directory entry with NULL enriched_at is pending: no resolver has answered
-- for its domain yet. The email pubsub workers retry pending entries of
-- tracked domains, at most a bounded number of times.
SET LOCAL lock_timeout = '5s';

ALTER TABLE crm_domain_directory
    ADD COLUMN enrichment_attempts SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN enrichment_attempted_at TIMESTAMPTZ;

-- Entries written before enriched_at existed were resolved by unfurl.
UPDATE crm_domain_directory
SET enriched_at = created_at
WHERE enriched_at IS NULL
  AND (name IS NOT NULL OR description IS NOT NULL OR icon_url IS NOT NULL);

-- Empty entries include the ones manual, API, and agent company creation
-- wrote through the no-op resolver. Make them pending so each gets one more
-- real resolve.
UPDATE crm_domain_directory
SET enriched_at = NULL
WHERE name IS NULL AND description IS NULL AND icon_url IS NULL;
