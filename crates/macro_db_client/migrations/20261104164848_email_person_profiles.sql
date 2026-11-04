-- Public professional profiles (LinkedIn link, headline, title, company,
-- photo) of the people in email threads, looked up from Apollo.io by address.
-- One row per lowercased address, shared by every viewer: it records nothing
-- about who corresponds with whom. A row whose profile columns are all NULL
-- caches a miss. `resolved_at` drives the refresh window; rows are replaced,
-- never deleted, so no foreign keys or cascades apply.
CREATE TABLE IF NOT EXISTS email_person_profiles (
    email_address     TEXT PRIMARY KEY,
    linkedin_url      TEXT,
    headline          TEXT,
    title             TEXT,
    organization_name TEXT,
    photo_url         TEXT,
    resolved_at       TIMESTAMPTZ NOT NULL
);
