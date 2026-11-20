-- `ANALYZE` estimates n_distinct(entity_access.source_id) from a 30,000-row
-- sample of a skewed column: 10,477, against 154,794 distinct sources in
-- 16.9M rows. Postgres then costs every source outside the most-common values
-- at about 1,300 grants, and `source_id = ANY(<thousands of channels>)` is
-- planned as millions of rows with sequential scans.
--
-- A negative value is a fraction of the row count, so the estimate grows with
-- the table: 154,794 / 16,898,606 = 0.00916. Only planner statistics change;
-- the setting stays across later (auto)analyzes.
SET LOCAL lock_timeout = '5s';

ALTER TABLE entity_access ALTER COLUMN source_id SET (n_distinct = -0.0092);

-- The setting takes effect at the next ANALYZE of the column.
ANALYZE entity_access (source_id);
