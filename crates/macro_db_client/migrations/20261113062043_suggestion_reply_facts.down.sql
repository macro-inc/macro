SET LOCAL lock_timeout = '5s';

ALTER TABLE suggestion_entity
    DROP COLUMN waiting_since,
    DROP COLUMN waiting_from,
    DROP COLUMN draft_preview;
