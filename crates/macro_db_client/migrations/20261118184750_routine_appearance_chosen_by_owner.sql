-- Whose choice a routine's appearance is. An agent picks an icon and colour for a routine it
-- drafts or changes, but never replaces a look the owner chose, including the choice of no
-- icon. Code deployed before these columns ignores them.
--
-- appearance_chosen_by_owner: the owner chose the look through the appearance endpoint. Code
-- with this column creates routines with false.
--
-- appearance_picked_by_agent: the look this code last stored as not the owner's (the look a
-- routine was created with, or an agent's pick). A replica still on older code changes the look
-- for the owner without setting appearance_chosen_by_owner, during the deploy or after a
-- rollback, so a look that differs from this one is the owner's.
--
-- Both are NULL on every routine that exists now, and on any routine an older replica creates.
-- When an agent next picks for one, set_appearance works out from the row whether its owner
-- chose (a look it has, or an appearance change in its activity), so nothing is backfilled.
SET LOCAL lock_timeout = '5s';

-- Columns with no default change only the catalog: no rewrite, no rows read.
ALTER TABLE scheduled_action
    ADD COLUMN appearance_chosen_by_owner BOOLEAN,
    ADD COLUMN appearance_picked_by_agent JSONB;
