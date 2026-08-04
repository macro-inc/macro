CREATE TABLE email_link_google_scopes (
    link_id uuid PRIMARY KEY REFERENCES email_links(id) ON DELETE CASCADE,
    granted_scopes text[] NOT NULL DEFAULT '{}',
    grant_version bigint NOT NULL DEFAULT 0 CHECK (grant_version >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION sync_email_link_google_scopes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO email_link_google_scopes (link_id, granted_scopes, grant_version)
    VALUES (NEW.id, NEW.google_granted_scopes, NEW.google_grant_version)
    ON CONFLICT (link_id) DO UPDATE
    SET granted_scopes = EXCLUDED.granted_scopes,
        grant_version = EXCLUDED.grant_version,
        updated_at = now()
    WHERE email_link_google_scopes.grant_version <= EXCLUDED.grant_version;

    RETURN NEW;
END;
$$;

CREATE TRIGGER email_links_sync_google_scopes
AFTER INSERT OR UPDATE OF google_granted_scopes, google_grant_version ON email_links
FOR EACH ROW
EXECUTE FUNCTION sync_email_link_google_scopes();

INSERT INTO email_link_google_scopes (link_id, granted_scopes, grant_version)
SELECT id, google_granted_scopes, google_grant_version
FROM email_links
ON CONFLICT (link_id) DO NOTHING;
