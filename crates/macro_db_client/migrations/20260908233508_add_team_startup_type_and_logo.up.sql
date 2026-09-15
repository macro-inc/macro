-- What kind of startup a team is building, and its logo. Both are optional
-- and captured on the onboarding team step. startup_type mirrors the
-- `StartupType` enum in crates/teams (snake_case wire values); it is TEXT
-- with a CHECK rather than a Postgres enum so adding a kind is a constraint
-- change, not a type migration.
ALTER TABLE team
    ADD COLUMN startup_type TEXT,
    ADD COLUMN logo_url TEXT,
    ADD CONSTRAINT team_startup_type_check CHECK (
        startup_type IN (
            'ai',
            'b2b_saas',
            'developer_tools',
            'fintech',
            'healthcare_biotech',
            'consumer',
            'marketplace_ecommerce',
            'hardware_deeptech',
            'climate_energy',
            'other'
        )
    ),
    ADD CONSTRAINT team_logo_url_length_check CHECK (char_length(logo_url) <= 2048);
