-- no-transaction
-- Removing a team key sets its usage rows' `provider_api_key_id` to NULL, so
-- the delete needs an index to find them. Partial: almost every row is paid
-- for by Macro and has no key. Built CONCURRENTLY so completions keep writing;
-- an INVALID leftover from an interrupted build must be dropped by hand first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_usage_provider_api_key_id_idx
    ON ai_usage (provider_api_key_id)
    WHERE provider_api_key_id IS NOT NULL;
