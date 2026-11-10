-- Sub-routines: a routine created by a routine's run belongs to that
-- routine. `parent_id` is the top-level routine it follows (one level: a
-- sub-routine's own creations attach to the same parent), `created_by_run_id`
-- the run that created it (a plain pointer: that run's history record is
-- written when the run ends), `child_key` the creating code's own name for
-- it, so the same parent and key update it instead of adding a duplicate.
-- `paused_by_parent` marks a sub-routine switched off because its parent
-- was, so switching the parent back on resumes only those.
--
-- Nullable columns and a constant default: no rewrite. The foreign key is
-- added NOT VALID so no scan runs under the lock; the next migration
-- validates it.
SET LOCAL lock_timeout = '5s';

ALTER TABLE scheduled_action
    ADD COLUMN parent_id UUID,
    ADD COLUMN created_by_run_id UUID,
    ADD COLUMN child_key TEXT,
    ADD COLUMN paused_by_parent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT scheduled_action_child_has_parent
        CHECK (parent_id IS NOT NULL OR (child_key IS NULL AND NOT paused_by_parent)) NOT VALID,
    ADD CONSTRAINT scheduled_action_parent_id_fkey
        FOREIGN KEY (parent_id) REFERENCES scheduled_action (id) ON DELETE CASCADE NOT VALID;
