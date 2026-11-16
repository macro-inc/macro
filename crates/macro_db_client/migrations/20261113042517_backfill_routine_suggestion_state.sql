-- Backfill routine_suggestion.state from the precedence readers used before it
-- was stored: saved (a routine of its owner's points back to it through
-- scheduled_action.suggestion_id), then dismissed, then retired, else open.
-- Then leave at most one open catalog pick per person and catalog key, for the
-- unique index the next migration builds, and move every suggestion card to
-- the state its routine suggestion now gives it. The check the previous
-- migration added is validated in its own migration
-- (20261113095436_validate_routine_suggestion_state).
--
-- routine_suggestion is small: it dates from 20261109001500 and is written
-- only for people with enable-routine-suggestions on, at most a few dozen rows
-- each, so the updates run in place in one pass each (about 150 ms for 150k
-- open catalog picks locally, the largest). Batch them instead if it ever
-- holds hundreds of thousands of rows. The saved backfill reads
-- scheduled_action once, as a join; it has no index on suggestion_id.
SET LOCAL lock_timeout = '5s';

UPDATE routine_suggestion s
SET state = 'saved'
FROM scheduled_action a
WHERE a.suggestion_id = s.id
  AND a.owner = s.user_id
  AND s.state <> 'saved';

UPDATE routine_suggestion
SET state = 'dismissed'
WHERE state = 'open' AND dismissed_at IS NOT NULL;

UPDATE routine_suggestion
SET state = 'retired'
WHERE state = 'open' AND retired_at IS NOT NULL;

-- Two sessions racing could keep the same catalog routine twice. Keep the one
-- with the best keep estimate (then the oldest) and retire the rest, as a
-- session would retire a duplicate. Catalog picks have no suggestion card.
UPDATE routine_suggestion s
SET state = 'retired', retired_at = now()
FROM (
    SELECT id,
           row_number() OVER (
               PARTITION BY user_id, catalog_key
               ORDER BY keep_probability DESC, created_at, id
           ) AS rank
    FROM routine_suggestion
    WHERE state = 'open' AND catalog_key IS NOT NULL
) ranked
WHERE s.id = ranked.id AND ranked.rank > 1;

-- A card shows its routine suggestion's state: open as proposed, saved as
-- done, dismissed and retired as themselves. Where an earlier build let a
-- card drift (accepted through the feed, say), it follows now. On a database
-- these cards were just created on, they already match.
UPDATE suggestion i
SET state = c.state, state_reason = NULL, updated_at = now(), state_changed_at = now()
FROM (
    SELECT r.suggestion_id,
           CASE s.state WHEN 'open' THEN 'proposed' WHEN 'saved' THEN 'done' ELSE s.state END AS state
    FROM suggestion_routine r
    JOIN routine_suggestion s ON s.id = r.routine_suggestion_id
) c
WHERE i.id = c.suggestion_id AND i.state <> c.state;
