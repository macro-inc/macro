-- A form made in passing, such as a channel poll, stays out of its owner's
-- Drive along with the database behind it. Set at creation.
ALTER TABLE forms ADD COLUMN is_hidden_in_drive BOOLEAN NOT NULL DEFAULT FALSE;
