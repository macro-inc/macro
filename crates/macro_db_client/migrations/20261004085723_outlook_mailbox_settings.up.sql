CREATE TABLE email_mailbox_settings_work (
    id UUID PRIMARY KEY,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('catalog','delete_label','sender_block')),
    resource_key TEXT NOT NULL,
    desired BOOLEAN NOT NULL DEFAULT true,
    revision BIGINT NOT NULL DEFAULT 1,
    completed_revision BIGINT NOT NULL DEFAULT 0,
    provider_rule_id TEXT,
    failure TEXT,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_id UUID,
    lease_until TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    UNIQUE(link_id,kind,resource_key)
);
CREATE INDEX email_mailbox_settings_work_due ON email_mailbox_settings_work(next_run_at);
INSERT INTO email_mailbox_settings_work (id,link_id,kind,resource_key)
    SELECT gen_random_uuid(),id,'catalog','' FROM email_links WHERE provider = 'OUTLOOK' AND is_sync_active;
