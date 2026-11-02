-- CRM contacts carry their own team so a contact can exist without a
-- company: personal-email contacts that email sync files when a team lets
-- personal emails in, and people added by hand without a company.
SET lock_timeout = '5s';

ALTER TABLE crm_contacts ADD COLUMN team_id UUID REFERENCES team (id) ON DELETE CASCADE;

-- Writers that predate the column insert without team_id during a rolling
-- deploy; take it from the company. New writers set it explicitly.
CREATE FUNCTION crm_contacts_fill_team_id() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.team_id IS NULL THEN
        SELECT team_id INTO NEW.team_id FROM crm_companies WHERE id = NEW.company_id;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER crm_contacts_fill_team_id
    BEFORE INSERT ON crm_contacts
    FOR EACH ROW EXECUTE FUNCTION crm_contacts_fill_team_id();

-- Backfill without touching updated_at, which listings show and sort by.
ALTER TABLE crm_contacts DISABLE TRIGGER crm_contacts_set_updated_at;
UPDATE crm_contacts ct
SET team_id = co.team_id
FROM crm_companies co
WHERE co.id = ct.company_id;
ALTER TABLE crm_contacts ENABLE TRIGGER crm_contacts_set_updated_at;

ALTER TABLE crm_contacts ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE crm_contacts ALTER COLUMN company_id DROP NOT NULL;

-- Email sync keeps personal-provider addresses (gmail.com etc.) out unless
-- the team turns this off.
ALTER TABLE team_crm_settings
    ADD COLUMN exclude_personal_emails BOOLEAN NOT NULL DEFAULT TRUE;

-- Domains a team keeps out of email sync. Stored lowercased.
CREATE TABLE crm_blocked_domains (
    team_id    UUID        NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    domain     TEXT        NOT NULL CHECK (domain = LOWER(domain)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, domain)
);
