-- WABA subscriptions are shared across phone connections, including different Macro teams.
CREATE INDEX meta_messaging_connection_business_idx
    ON meta_messaging_connection (provider, business_account_id)
    WHERE business_account_id IS NOT NULL;
