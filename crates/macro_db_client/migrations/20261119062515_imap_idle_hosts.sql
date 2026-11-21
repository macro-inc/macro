SET LOCAL lock_timeout = '5s';

-- Shared protocol timing only; the key is a digest so personal hostnames are not retained.
CREATE TABLE imap_idle_hosts (
    host_hash TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX imap_idle_hosts_expiry ON imap_idle_hosts(updated_at);
