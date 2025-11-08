-- Add migration script here
ALTER TABLE team ADD COLUMN seat_count INT NOT NULL DEFAULT 0;
