-- Contact upserts only change updated_at, so they are HOT updates, and HOT
-- pruning subtracts the dead tuples it reclaims from the count that triggers
-- autovacuum. The default 10% threshold is never reached, so the table is
-- vacuumed only when its transaction age forces it, days apart. Pages changed
-- since the last vacuum are not all-visible, and the contacts list's
-- index-only scans read the table for them. Vacuum after a fixed number of
-- changes instead.
--
-- Setting autovacuum options takes SHARE UPDATE EXCLUSIVE, which doesn't block
-- reads or writes but waits behind a running vacuum; give up rather than wait.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.contacts_connections SET (
    autovacuum_vacuum_scale_factor = 0,
    autovacuum_vacuum_threshold = 1000,
    autovacuum_vacuum_insert_scale_factor = 0,
    autovacuum_vacuum_insert_threshold = 1000
);
