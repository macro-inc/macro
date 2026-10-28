ALTER TABLE team_crm_settings
    ADD COLUMN IF NOT EXISTS legacy_stage_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN team_crm_settings.legacy_stage_ids IS
    'System stage option id -> team stage option id, recorded when the team set is seeded';
