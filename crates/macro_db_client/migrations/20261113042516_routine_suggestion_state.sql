-- Where a routine suggestion is, stored instead of derived: `open`, `dismissed`
-- by the person (never suggested again), `retired` by a routines session (it
-- may be suggested again) or `saved` as a routine. The domain's transition
-- function (`RoutineSuggestionState::on` in crates/scheduled_action) is the
-- only writer, and moves the suggestion card with it. `dismissed_at` and
-- `retired_at` stay as the times it was dismissed and retired.
--
-- The next migration backfills existing rows, and 20261113095436 validates
-- the check. A constant default adds the column without rewriting the table,
-- and the check is added NOT VALID, so this file only holds the ALTER's lock
-- briefly.
--
-- The previous release never sets `state`: a row it inserts is `open`, and a
-- row it dismisses during the deploy window keeps `open` with `dismissed_at`
-- set (the check allows that). Accepted for the minutes of the deploy, like
-- the window 20261109212700 describes.
SET LOCAL lock_timeout = '5s';

ALTER TABLE routine_suggestion
    ADD COLUMN state text NOT NULL DEFAULT 'open',
    ADD CONSTRAINT routine_suggestion_state_check CHECK (
        state IN ('open', 'dismissed', 'retired', 'saved')
        AND (state <> 'dismissed' OR dismissed_at IS NOT NULL)
        AND (state <> 'retired' OR retired_at IS NOT NULL)
    ) NOT VALID;
