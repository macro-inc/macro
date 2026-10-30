-- Card-on-file credit charges share ai_credit_reload: automatic reloads and
-- one-time purchases both count against the payer's monthly credit limit.
-- `kind` separates them so a failed purchase never pauses automatic reloads
-- and automatic retries never pick up a purchase. `purchased_by` records which
-- team member asked for a purchase; it is NULL for automatic reloads.
SET LOCAL lock_timeout = '5s';

CREATE TYPE ai_credit_reload_kind AS ENUM ('automatic', 'purchase');

ALTER TABLE ai_credit_reload
    ADD COLUMN kind ai_credit_reload_kind NOT NULL DEFAULT 'automatic',
    ADD COLUMN purchased_by TEXT;
