-- Pending directory entries the enrichment worker can no longer claim leave
-- the claimable set, so claiming stops walking them on every pass:
-- exhausted entries have used every enrichment attempt, untracked entries
-- have a domain no team tracks. The worker marks both as it finds them;
-- tracking the domain again clears enrichment_untracked.
SET LOCAL lock_timeout = '5s';

ALTER TABLE crm_domain_directory
    ADD COLUMN enrichment_exhausted BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN enrichment_untracked BOOLEAN NOT NULL DEFAULT false;
