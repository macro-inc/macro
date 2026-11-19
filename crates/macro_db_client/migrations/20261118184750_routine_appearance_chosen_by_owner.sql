-- Whose choice a routine's appearance is. An agent picks an icon and colour for a routine it
-- drafts or changes, but never replaces a look the owner chose, including the choice of no
-- icon. Code deployed before these columns ignores them.
--
-- appearance_chosen_by_owner: the owner chose the look through the appearance endpoint. Code
-- with this column creates routines with false.
--
-- appearance_changes_by_agent: how many of the routine's appearance_changed activity events an
-- agent's pick recorded. Every change to a look records one, on this code and on older code, so
-- a replica still on older code, during the deploy or after a rollback, changes the look for the
-- owner without setting appearance_chosen_by_owner but leaves an event beyond this count. Code
-- with this column creates routines with 0.
--
-- Both are NULL on every routine that exists now, and on any routine an older replica creates.
-- When an agent next picks for one, set_appearance works out from the row whether its owner
-- chose (a look it has, or an appearance change in its activity), so nothing is backfilled.
SET LOCAL lock_timeout = '5s';

-- Columns with no default change only the catalog: no rewrite, no rows read.
ALTER TABLE scheduled_action
    ADD COLUMN appearance_chosen_by_owner BOOLEAN,
    ADD COLUMN appearance_changes_by_agent INTEGER;
