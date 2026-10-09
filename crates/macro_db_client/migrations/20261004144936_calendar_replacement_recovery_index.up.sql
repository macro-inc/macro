CREATE INDEX calendar_event_replacements_recovery
    ON calendar_event_replacements (updated_at, id)
    WHERE result IS NULL AND (next_step > 0 OR command IS NOT NULL);
