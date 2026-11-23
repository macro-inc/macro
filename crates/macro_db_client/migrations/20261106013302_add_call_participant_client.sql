SET LOCAL lock_timeout = '5s';

ALTER TABLE call_participants
    ADD COLUMN client TEXT NOT NULL DEFAULT 'person';
