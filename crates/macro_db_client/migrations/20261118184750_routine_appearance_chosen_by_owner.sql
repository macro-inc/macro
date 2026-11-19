-- Whether a routine's owner chose its appearance through the appearance endpoint. An agent picks
-- an icon and colour for a routine it drafts or changes, but never replaces one the owner chose,
-- including the choice of no icon. Code deployed before this column ignores it.
--
-- NULL records no choice: every routine that exists now, and any routine a replica still on
-- older code creates during the deploy or after a rollback. When an agent next picks for one,
-- set_appearance works out from the row whether its owner chose (a look it has, or an
-- appearance change in its activity), so nothing is backfilled and an owner's choice made on an
-- older replica counts too. Code with this column creates routines with false.
SET LOCAL lock_timeout = '5s';

-- A column with no default changes only the catalog: no rewrite, no rows read.
ALTER TABLE scheduled_action
    ADD COLUMN appearance_chosen_by_owner BOOLEAN;
