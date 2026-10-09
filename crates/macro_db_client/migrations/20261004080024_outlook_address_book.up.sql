ALTER TABLE email_sync_streams DROP CONSTRAINT email_sync_streams_kind_check;
ALTER TABLE email_sync_streams ADD CONSTRAINT email_sync_streams_kind_check CHECK
    (kind IN ('folder_catalog','mail_folder','gmail_history','gmail_backfill','contacts','contacts_catalog','contacts_profile','calendar'));
ALTER TABLE email_sync_streams ADD COLUMN scan_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE email_address_book_folders (
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    provider_id text NOT NULL,
    is_default boolean NOT NULL,
    PRIMARY KEY (link_id, provider_id)
);
CREATE TABLE email_address_book_sources (
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    folder_id text NOT NULL,
    provider_id text NOT NULL,
    display_name text,
    emails text[] NOT NULL,
    scan_id uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    photo_url text,
    photo_hash text,
    photo_due_at timestamptz NOT NULL DEFAULT now(),
    photo_lease_id uuid,
    photo_lease_until timestamptz,
    PRIMARY KEY (link_id, folder_id, provider_id)
);
CREATE INDEX email_address_book_sources_emails ON email_address_book_sources USING gin(emails);
CREATE INDEX email_address_book_sources_photo_due ON email_address_book_sources(photo_due_at) WHERE deleted_at IS NULL;

-- Retain header-derived names and preexisting photos when a saved contact takes
-- precedence. Deleting an address-book entry never deletes message recipients.
CREATE TABLE email_contact_address_book_projection (
    contact_id uuid PRIMARY KEY REFERENCES email_contacts(id) ON DELETE CASCADE,
    previous_name text,
    applied_name text,
    previous_photo text,
    applied_photo text
);
INSERT INTO email_sync_streams(id, link_id, generation, kind, scope_id)
SELECT gen_random_uuid(), l.id, l.sync_generation, kind, 'address_book'
FROM email_links l CROSS JOIN (VALUES ('contacts_catalog'), ('contacts_profile')) jobs(kind)
WHERE l.provider = 'OUTLOOK' AND l.is_sync_active
ON CONFLICT DO NOTHING;
