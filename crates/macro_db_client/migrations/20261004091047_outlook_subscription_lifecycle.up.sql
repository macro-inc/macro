ALTER TABLE email_provider_subscriptions DROP CONSTRAINT email_provider_subscriptions_pkey;
ALTER TABLE email_provider_subscriptions ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE email_provider_subscriptions ADD PRIMARY KEY(id);
ALTER TABLE email_provider_subscriptions ALTER COLUMN provider_id DROP NOT NULL;
CREATE INDEX email_provider_subscriptions_link ON email_provider_subscriptions(link_id,generation);
CREATE TABLE email_mailbox_watch_work (
    link_id UUID PRIMARY KEY REFERENCES email_links(id) ON DELETE CASCADE,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_id UUID,
    lease_until TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT 1
);
INSERT INTO email_mailbox_watch_work(link_id) SELECT id FROM email_links WHERE provider='OUTLOOK' AND is_sync_active;
ALTER TABLE email_sync_streams ADD COLUMN notified_at TIMESTAMPTZ;
ALTER TABLE email_sync_streams ADD COLUMN lease_started_at TIMESTAMPTZ;
