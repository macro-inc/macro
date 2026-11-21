-- no-transaction
-- Only preview metadata is indexed; each start/claim/status transition updates
-- this index. Interrupted invalid builds must be dropped before retrying.
CREATE INDEX CONCURRENTLY crm_email_policy_previews_due
ON crm_email_policy_previews(run_after,team_id,user_id)
WHERE request_hash IS NOT NULL AND status IN ('pending','running');
