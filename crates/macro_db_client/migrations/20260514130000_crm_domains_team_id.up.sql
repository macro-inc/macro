-- Denormalize team_id onto crm_domains so we can enforce
-- UNIQUE(team_id, LOWER(domain)) directly. Without this, the upsert path in
-- crm::outbound::companies_repo::populate_contact races: two concurrent
-- transactions can both SELECT-and-see-nothing for the same (team, domain)
-- and both INSERT a new crm_companies row, leaving the team with duplicate
-- companies for the same domain.

ALTER TABLE crm_domains
    ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES team (id) ON DELETE CASCADE;

-- Backfill from the parent crm_companies row. In practice the v1 PR has not
-- shipped to prod yet so the table is empty, but the UPDATE is cheap and
-- keeps the migration safe to apply against any environment that already has
-- crm_companies/crm_domains rows.
UPDATE crm_domains d
SET team_id = c.team_id
FROM crm_companies c
WHERE d.company_id = c.id
  AND d.team_id IS NULL;

ALTER TABLE crm_domains
    ALTER COLUMN team_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_domains_team_id_lower_domain_unique
    ON crm_domains (team_id, LOWER(domain));
