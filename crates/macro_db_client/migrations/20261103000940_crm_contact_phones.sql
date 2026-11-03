-- A contact's phone numbers, in E.164, for showing, calling, and matching the
-- people on imported phone calls. Numbers identify people the way addresses
-- do, so they are CRM data with a format check and an index, not a free-text
-- property. A number may belong to several contacts (a shared office line).
CREATE TABLE crm_contact_phones (
    contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL CHECK (phone ~ '^[+][1-9][0-9]{6,14}$'),
    -- Where the number came from: typed on the contact, a CSV import, or a
    -- Dialpad call with a contact matched by email.
    source TEXT NOT NULL CHECK (source IN ('manual', 'csv', 'dialpad')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (contact_id, phone)
);
CREATE INDEX crm_contact_phones_phone_idx ON crm_contact_phones(phone);
