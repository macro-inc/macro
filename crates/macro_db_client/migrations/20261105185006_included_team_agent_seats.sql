-- Included agent seats must never decrement a paid seat on removal.
SET LOCAL lock_timeout = '5s';

ALTER TABLE team_user ADD COLUMN seat_included BOOLEAN NOT NULL DEFAULT FALSE;
