-- Existing sessions retain their private/channel access until the owner changes sharing.
ALTER TABLE agent_session
    ADD COLUMN share_permission_id TEXT UNIQUE REFERENCES "SharePermission"(id);
