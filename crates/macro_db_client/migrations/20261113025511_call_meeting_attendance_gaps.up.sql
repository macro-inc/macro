SET LOCAL lock_timeout = '5s';

-- Deleting evidence must not turn an unknown outcome into an inferred absence.
ALTER TABLE call_meetings ADD COLUMN attendance_incomplete BOOLEAN NOT NULL DEFAULT false;
