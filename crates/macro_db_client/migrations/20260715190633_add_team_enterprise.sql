-- Enterprise teams are billed out-of-band; membership changes skip all
-- Stripe subscription bookkeeping for them.
ALTER TABLE team
    ADD COLUMN enterprise BOOLEAN NOT NULL DEFAULT FALSE;
