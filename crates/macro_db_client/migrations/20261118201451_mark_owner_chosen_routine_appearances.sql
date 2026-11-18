-- Until now only the appearance endpoint and templates set a routine's appearance: keep every
-- routine that has one as it is. Row locks only; a routine has at most one row.
SET LOCAL lock_timeout = '5s';

UPDATE scheduled_action
SET appearance_chosen_by_owner = true
WHERE appearance IS NOT NULL
    AND jsonb_strip_nulls(appearance) <> '{}'::jsonb
    AND NOT appearance_chosen_by_owner;
