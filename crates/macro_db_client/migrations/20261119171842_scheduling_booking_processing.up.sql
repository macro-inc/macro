-- no-transaction
-- A booking link's daily limit also counts a reschedule still waiting on the
-- calendar on the day it left, since a refusal puts it back there. That count
-- reads the profile's bookings in 'processing', which are a handful at any
-- time; without this index it reads every booking the profile has.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduling_booking_processing
    ON scheduling_booking (profile_id) WHERE status = 'processing';
