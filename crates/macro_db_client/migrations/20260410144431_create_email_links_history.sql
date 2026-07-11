CREATE TABLE IF NOT EXISTS email_links_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id UUID NOT NULL,
    fusionauth_user_id TEXT NOT NULL,
    email_address VARCHAR(320) NOT NULL,
    provider email_user_provider_enum NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    deletion_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_links_history_fusionauth_user_id ON email_links_history (fusionauth_user_id);
CREATE INDEX IF NOT EXISTS idx_email_links_history_link_id_not_deleted ON email_links_history (link_id) WHERE deleted_at IS NULL;
