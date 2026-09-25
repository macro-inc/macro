-- Monotonic generation of a payer's open-seat roster.
--
-- Removal bumps this even when the open allowance row does not exist yet, so a
-- roster read from before the bump cannot be stored. Deployed writers omit the
-- column; the default keeps this migration compatible with them.
ALTER TABLE ai_billing_account
    ADD COLUMN seat_generation BIGINT NOT NULL DEFAULT 0;
