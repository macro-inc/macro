ALTER TABLE email_sync_streams DROP COLUMN notified_at,DROP COLUMN lease_started_at;
DROP TABLE email_mailbox_watch_work;
DELETE FROM email_provider_subscriptions WHERE provider_id IS NULL;
DELETE FROM email_provider_subscriptions older USING email_provider_subscriptions newer
    WHERE older.link_id=newer.link_id AND older.generation=newer.generation AND older.id<newer.id;
ALTER TABLE email_provider_subscriptions DROP CONSTRAINT email_provider_subscriptions_pkey;
ALTER TABLE email_provider_subscriptions DROP COLUMN id;
ALTER TABLE email_provider_subscriptions ALTER COLUMN provider_id SET NOT NULL;
ALTER TABLE email_provider_subscriptions ADD PRIMARY KEY(link_id,generation);
DROP INDEX email_provider_subscriptions_link;
