SET LOCAL lock_timeout = '5s';

-- Connection ownership is separate from short command leases. Owners close sockets
-- within 240 seconds; takeover waits 360 seconds, leaving a fenced handover gap.
CREATE TABLE imap_account_owners (
    link_id UUID PRIMARY KEY REFERENCES imap_accounts(link_id) ON DELETE CASCADE,
    owner_id UUID NOT NULL,
    sync_generation BIGINT NOT NULL,
    grant_generation BIGINT NOT NULL,
    lease_until TIMESTAMPTZ NOT NULL
);
