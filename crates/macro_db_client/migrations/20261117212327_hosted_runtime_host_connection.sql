-- How the control plane reaches each Firecracker host, and how many of a
-- host's fleet effects (creates, starts) it runs at once.

-- Purchases and effect leases lock host rows; never queue behind one of them.
SET LOCAL lock_timeout = '3s';

ALTER TABLE hosted_runtime_host
    -- The host agent's base URL; null for the local Docker host, which its
    -- control plane's environment configures.
    ADD COLUMN endpoint TEXT,
    -- The host agent's self-signed certificate (public), pinned by the client.
    ADD COLUMN server_certificate_pem TEXT,
    ADD CONSTRAINT hosted_runtime_host_connection
        CHECK ((endpoint IS NULL) = (server_certificate_pem IS NULL)),
    ADD COLUMN max_concurrent_starts INTEGER NOT NULL DEFAULT 1
        CHECK (max_concurrent_starts > 0);
