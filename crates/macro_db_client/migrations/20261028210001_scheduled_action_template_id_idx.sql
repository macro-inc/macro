-- no-transaction
-- Counts the routines activated from a template. Partial: most routines were
-- not activated from one. Built CONCURRENTLY so routine writes continue; an
-- INVALID leftover from an interrupted build must be dropped by hand first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduled_action_template_id_idx
    ON scheduled_action (template_id)
    WHERE template_id IS NOT NULL;
