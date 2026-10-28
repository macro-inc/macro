-- The sandbox's one secret, as it is stored: the SHA-256 hex digest of the
-- opaque session token, never the token itself. A database dump must not yield
-- a live credential.
--
-- Nullable because a session that never had a sandbox provisioned - a replayed
-- recording, a row from before egress existed - has no token, and because the
-- rows already in this table have none.
ALTER TABLE agent_session
    ADD COLUMN egress_token_hash text;

-- Partial: the digests that exist must be unique, since this index is what the
-- egress proxy authenticates by, while the many rows without one are not in
-- conflict with each other.
CREATE UNIQUE INDEX agent_session_egress_token_hash_key
    ON agent_session (egress_token_hash)
    WHERE egress_token_hash IS NOT NULL;
