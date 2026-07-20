-- Team CRM configuration moves from the legacy `__macro:crm-config` property
-- definition hack into real columns on team_crm_settings.
-- Team saved views intentionally stay an opaque jsonb blob for fast iteration.

ALTER TABLE team_crm_settings
    ADD COLUMN edit_stages_role       team_role NOT NULL DEFAULT 'admin',
    ADD COLUMN move_closed_deals_role team_role NOT NULL DEFAULT 'admin',
    ADD COLUMN delete_records_role    team_role NOT NULL DEFAULT 'admin',
    ADD COLUMN closed_stage_ids       uuid[],
    ADD COLUMN team_views             jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN default_team_view_id   text;

COMMENT ON COLUMN team_crm_settings.closed_stage_ids IS
    'Stage option ids counting as closed deals; NULL = label heuristic on the client';
COMMENT ON COLUMN team_crm_settings.team_views IS
    'Opaque array of team saved views, owned by the frontend';

-- Backfill from the legacy `__macro:crm-config` property definitions, whose
-- single select option holds the JSON config in string_value. Invalid or
-- unparsable configs are skipped (columns keep their defaults).
DO $$
DECLARE
    rec       RECORD;
    cfg       jsonb;
    v_edit    team_role;
    v_move    team_role;
    v_del     team_role;
    v_closed  uuid[];
    v_views   jsonb;
    v_default text;
BEGIN
    FOR rec IN
        SELECT DISTINCT ON (pd.team_id) pd.team_id, po.string_value
        FROM property_definitions pd
        JOIN property_options po ON po.property_definition_id = pd.id
        WHERE pd.display_name = '__macro:crm-config'
          AND pd.team_id IS NOT NULL
        ORDER BY pd.team_id, pd.created_at ASC, po.display_order ASC
    LOOP
        BEGIN
            cfg := rec.string_value::jsonb;
        EXCEPTION WHEN others THEN
            CONTINUE;
        END;
        IF cfg IS NULL OR jsonb_typeof(cfg) <> 'object' THEN
            CONTINUE;
        END IF;

        v_edit := CASE WHEN cfg #>> '{permissions,editStages}' IN ('admin', 'owner')
                       THEN (cfg #>> '{permissions,editStages}')::team_role
                       ELSE 'admin' END;
        v_move := CASE WHEN cfg #>> '{permissions,moveClosedDeals}' IN ('admin', 'owner')
                       THEN (cfg #>> '{permissions,moveClosedDeals}')::team_role
                       ELSE 'admin' END;
        v_del  := CASE WHEN cfg #>> '{permissions,deleteRecords}' IN ('admin', 'owner')
                       THEN (cfg #>> '{permissions,deleteRecords}')::team_role
                       ELSE 'admin' END;

        v_closed := NULL;
        IF jsonb_typeof(cfg -> 'closedStageIds') = 'array' THEN
            BEGIN
                SELECT array_agg(value::uuid) INTO v_closed
                FROM jsonb_array_elements_text(cfg -> 'closedStageIds');
            EXCEPTION WHEN others THEN
                -- Non-uuid entries: fall back to the label heuristic.
                v_closed := NULL;
            END;
        END IF;

        v_views := CASE WHEN jsonb_typeof(cfg -> 'teamViews') = 'array'
                        THEN cfg -> 'teamViews'
                        ELSE '[]'::jsonb END;
        v_default := cfg ->> 'defaultTeamViewId';

        -- INSERT branch leaves crm_enabled at its FALSE default, matching
        -- the existing "no row = disabled" semantics.
        INSERT INTO team_crm_settings (team_id, edit_stages_role, move_closed_deals_role,
                                       delete_records_role, closed_stage_ids, team_views,
                                       default_team_view_id)
        VALUES (rec.team_id, v_edit, v_move, v_del, v_closed, v_views, v_default)
        ON CONFLICT (team_id) DO UPDATE SET
            edit_stages_role       = EXCLUDED.edit_stages_role,
            move_closed_deals_role = EXCLUDED.move_closed_deals_role,
            delete_records_role    = EXCLUDED.delete_records_role,
            closed_stage_ids       = EXCLUDED.closed_stage_ids,
            team_views             = EXCLUDED.team_views,
            default_team_view_id   = EXCLUDED.default_team_view_id,
            updated_at             = now();
    END LOOP;
END $$;
