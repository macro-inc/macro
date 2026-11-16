-- Every address a CRM contact is known by, so one person can be reached at a
-- work address and a personal one. crm_contacts.email stays the contact's
-- primary address; lookups by address read this table. Stored trimmed and
-- lowercased.
SET LOCAL lock_timeout = '5s';

CREATE TABLE crm_contact_emails (
    contact_id UUID        NOT NULL REFERENCES crm_contacts (id) ON DELETE CASCADE,
    email      TEXT        NOT NULL CHECK (email <> '' AND email = LOWER(BTRIM(email))),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (contact_id, email)
);

CREATE INDEX crm_contact_emails_email_idx ON crm_contact_emails (email);

-- The primary address is always one of the contact's addresses. A trigger
-- records it so writers that predate this table keep it complete during a
-- rolling deploy. Changing the primary leaves the previous address in place;
-- removing an address is an explicit delete.
CREATE FUNCTION crm_contacts_record_primary_email() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NULLIF(BTRIM(NEW.email), '') IS NOT NULL THEN
        INSERT INTO crm_contact_emails (contact_id, email)
        VALUES (NEW.id, LOWER(BTRIM(NEW.email)))
        ON CONFLICT (contact_id, email) DO NOTHING;
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER crm_contacts_record_primary_email
    AFTER INSERT OR UPDATE OF email ON crm_contacts
    FOR EACH ROW EXECUTE FUNCTION crm_contacts_record_primary_email();
