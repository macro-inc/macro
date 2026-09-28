-- Intentionally a no-op: the backfill only records existing legacy grants as
-- canonical state (and grants active calls what their flag promised). Once
-- canonical writers run, their edits are indistinguishable from backfilled
-- rows, so reversing would discard real consent. Neither direction changes
-- the legacy share_with_team semantics for older readers.
SELECT 1;
