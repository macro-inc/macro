-- no-transaction
-- "UserHistory"."itemId" is text, so the CRM companies list joins a user's
-- viewed companies on id::text. Without this index that join reads the team.
-- Must stay a single statement (see the last_interaction index). IF NOT EXISTS
-- does not repair an INVALID index left by an interrupted build; drop it
-- concurrently before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_companies_id_text_idx
    ON crm_companies ((id::text));
