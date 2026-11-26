-- no-transaction
CREATE INDEX CONCURRENTLY crm_email_rule_companies_source
ON crm_email_rule_companies(company_id, team_id, user_id, revision);
