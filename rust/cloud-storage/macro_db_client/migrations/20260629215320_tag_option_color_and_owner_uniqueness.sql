-- macro-2102: tags v0. Per-option color, and one tag set per owner.

-- Per-label color, stored as a hex string (e.g. '#E5484D'). NULL for non-tag options.
ALTER TABLE property_options ADD COLUMN IF NOT EXISTS color TEXT;

-- Keep persisted colors aligned with the handler validation: NULL or a #RRGGBB hex string.
ALTER TABLE property_options DROP CONSTRAINT IF EXISTS property_options_color_hex;
ALTER TABLE property_options
    ADD CONSTRAINT property_options_color_hex
    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');

-- A user or a team owns at most one tag set. These partial unique indexes enforce a
-- single TAG-typed definition per owner, so the tag set resolves deterministically.
-- (System-owned tag definitions are not used - tags are always user- or team-owned.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_definition_per_team
    ON property_definitions (team_id)
    WHERE data_type = 'TAG' AND team_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_definition_per_user
    ON property_definitions (user_id)
    WHERE data_type = 'TAG' AND user_id IS NOT NULL;

-- Tag definitions are owner singletons (the indexes above), so exempt them from the
-- display-name uniqueness that applies to user-created properties. This lets the
-- auto-provisioned tag definition coexist with a same-named user property instead of
-- failing to provision the tag set. Non-tag properties keep their per-owner name uniqueness.
ALTER TABLE property_definitions
    DROP CONSTRAINT IF EXISTS unique_property_definitions_user_display_name;
ALTER TABLE property_definitions
    DROP CONSTRAINT IF EXISTS unique_property_definitions_team_display_name;
CREATE UNIQUE INDEX IF NOT EXISTS unique_property_definitions_user_display_name
    ON property_definitions (user_id, display_name)
    WHERE user_id IS NOT NULL AND data_type <> 'TAG';
CREATE UNIQUE INDEX IF NOT EXISTS unique_property_definitions_team_display_name
    ON property_definitions (team_id, display_name)
    WHERE team_id IS NOT NULL AND data_type <> 'TAG';
