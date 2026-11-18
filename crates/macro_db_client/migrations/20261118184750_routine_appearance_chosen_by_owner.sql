-- Whether a routine's owner chose its appearance through the appearance endpoint. An agent picks
-- an icon and colour for a routine it drafts or changes, but never replaces one the owner chose,
-- including the choice of no icon. Code deployed before this column ignores it.
SET LOCAL lock_timeout = '5s';

-- A constant default adds the column without rewriting the table.
ALTER TABLE scheduled_action
    ADD COLUMN appearance_chosen_by_owner BOOLEAN NOT NULL DEFAULT false;

-- Until now only the appearance endpoint and templates set a routine's appearance: keep every
-- routine that has one as it is.
UPDATE scheduled_action
SET appearance_chosen_by_owner = true
WHERE appearance IS NOT NULL
    AND jsonb_strip_nulls(appearance) <> '{}'::jsonb;
