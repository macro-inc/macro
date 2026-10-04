-- Both event-only and mixed routines use the same bounded admission query.
DROP INDEX scheduled_action_event_filters_idx;
CREATE INDEX scheduled_action_event_filters_idx
    ON scheduled_action USING GIN (event_filters jsonb_path_ops)
    WHERE event_filters IS NOT NULL AND enabled;
