ALTER TABLE team
    DROP CONSTRAINT IF EXISTS team_logo_url_length_check,
    DROP CONSTRAINT IF EXISTS team_startup_type_check,
    DROP COLUMN IF EXISTS logo_url,
    DROP COLUMN IF EXISTS startup_type;
