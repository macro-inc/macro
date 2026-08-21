-- This migration is intentionally irreversible: the legacy grant columns are
-- removed after their values are copied to the side table.
CREATE TABLE email_link_google_scopes (
    link_id uuid PRIMARY KEY REFERENCES email_links(id) ON DELETE CASCADE,
    granted_scopes text[] NOT NULL DEFAULT '{}',
    grant_version bigint NOT NULL DEFAULT 0 CHECK (grant_version >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO email_link_google_scopes (link_id, granted_scopes, grant_version)
SELECT id, google_granted_scopes, google_grant_version
FROM email_links;

ALTER TABLE email_links
    DROP COLUMN google_granted_scopes,
    DROP COLUMN google_grant_version;
