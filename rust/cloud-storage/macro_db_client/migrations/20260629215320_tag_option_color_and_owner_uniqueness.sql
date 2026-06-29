-- macro-2102: tags v0. Per-option color, and one tag set per owner.

-- Per-label color, stored as a hex string (e.g. '#E5484D'). NULL for non-tag options.
ALTER TABLE property_options ADD COLUMN color TEXT;

-- A user or a team owns at most one tag set. These partial unique indexes enforce a
-- single TAG-typed definition per owner, so the tag set resolves deterministically.
-- (System-owned tag definitions are not used - tags are always user- or team-owned.)
CREATE UNIQUE INDEX uq_tag_definition_per_team
    ON property_definitions (team_id)
    WHERE data_type = 'TAG' AND team_id IS NOT NULL;

CREATE UNIQUE INDEX uq_tag_definition_per_user
    ON property_definitions (user_id)
    WHERE data_type = 'TAG' AND user_id IS NOT NULL;
