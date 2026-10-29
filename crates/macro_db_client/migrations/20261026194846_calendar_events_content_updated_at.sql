-- The provider stamp of a user edit written through the organizer's copy whose
-- title, description, location, and visibility the entity carries ahead of its
-- canonical copy, which Google updates some seconds later. The canonical copy
-- retakes that content once it is at least this fresh, which clears the stamp.
-- NULL while the entity's content is its canonical copy's. Nullable, so code
-- deployed before this change keeps working.
SET LOCAL lock_timeout = '5s';

ALTER TABLE calendar_events ADD COLUMN content_updated_at timestamptz;
