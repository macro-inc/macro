-- One line a background run writes for the person before it ends, saying what
-- it did and what it sent ("12 seats added · Nothing was sent"), shown on its
-- finished card. Null until the run writes it; a new run is a new row.
-- A nullable column with no default changes only the catalog; don't queue
-- behind a long transaction for its lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE suggestion_run ADD COLUMN report text;
