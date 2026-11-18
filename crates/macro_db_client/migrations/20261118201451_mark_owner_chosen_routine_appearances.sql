-- Until now only the appearance endpoint and templates set a routine's appearance: keep every
-- routine that has one as it is. A routine whose look was reset to none through the endpoint
-- has no appearance left, but the endpoint recorded the change in its activity, so keep that
-- choice too. Row locks only; a routine has at most one row. The activity lookup is one
-- index-only scan of idx_activity_events_entity_action_timeline over routines' entries.
SET LOCAL lock_timeout = '5s';

UPDATE scheduled_action
SET appearance_chosen_by_owner = true
WHERE NOT appearance_chosen_by_owner
    AND (
        (appearance IS NOT NULL AND jsonb_strip_nulls(appearance) <> '{}'::jsonb)
        OR EXISTS (
            SELECT 1
            FROM activity_events
            WHERE activity_events.entity_type = 'scheduled_action'
                AND activity_events.entity_id = scheduled_action.id::text
                AND activity_events.action = 'appearance_changed'
        )
    );
