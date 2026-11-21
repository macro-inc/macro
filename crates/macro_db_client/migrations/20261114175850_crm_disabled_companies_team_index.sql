-- no-transaction
-- Privacy responses enumerate only this team's legacy disabled-company rules.
-- Keep one statement so SQLx can build concurrently. An interrupted build can
-- leave an invalid index; drop it concurrently before retrying this migration.
CREATE INDEX CONCURRENTLY crm_companies_disabled_email_team_idx
    ON crm_companies (team_id, id) WHERE NOT email_sync;
