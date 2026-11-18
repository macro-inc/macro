-- Whether a routine's owner chose its appearance through the appearance endpoint. An agent picks
-- an icon and colour for a routine it drafts or changes, but never replaces one the owner chose,
-- including the choice of no icon. Code deployed before this column ignores it.
SET LOCAL lock_timeout = '5s';

-- A constant default adds the column without rewriting the table. The next migration marks the
-- routines that already have a look, in its own transaction, so this lock is held only briefly.
ALTER TABLE scheduled_action
    ADD COLUMN appearance_chosen_by_owner BOOLEAN NOT NULL DEFAULT false;
