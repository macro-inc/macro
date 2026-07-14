DROP INDEX IF EXISTS crm_domains_team_id_lower_domain_unique;

ALTER TABLE crm_domains
    DROP COLUMN IF EXISTS team_id;
