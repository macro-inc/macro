CREATE TABLE memory_refresh_job (
    user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    lease_token UUID,
    lease_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX memory_refresh_job_lease_idx ON memory_refresh_job (lease_until, user_id);
-- Enroll existing memory users; do not publish or copy their legacy private text.
INSERT INTO memory_refresh_job (user_id)
SELECT DISTINCT m.user_id FROM memory m JOIN "User" u ON u.id = m.user_id
ON CONFLICT DO NOTHING;
