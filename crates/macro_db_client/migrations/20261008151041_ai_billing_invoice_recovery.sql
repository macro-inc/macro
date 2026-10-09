-- AI billing: recover one-off invoices Stripe could not simply collect.
--
-- Overage chunks and automatic credit reloads are collected through one-off
-- Stripe invoices. Until now a row only knew `pending`, `paid`, and `failed`,
-- and the webhook only reported paid/failed, so three provider outcomes had no
-- home: a payment that needs the customer to authenticate (3-D Secure), an
-- invoice Stripe voided, and one it wrote off as uncollectible. Such rows sat
-- `pending` forever, and a pending reload blocks every further reload.
--
-- New statuses, mirroring Stripe's own vocabulary:
--   requires_action  the invoice is open but its payment needs the payer to
--                    authenticate on the Stripe-hosted invoice page. Like a
--                    failure it pauses the feature until the payer acts, and
--                    it still counts as collectible (blocks/covers/spends).
--   voided           final; the invoice will never collect. Stops blocking,
--                    covering usage, and counting against the monthly limit.
--   uncollectible    written off; no more automatic collection. Treated like
--                    voided, except a late payment can still report it paid.
--
-- `hosted_invoice_url` stores the page where the payer completes a payment
-- that requires action, so the usage summary can link to it.
--
-- Compatibility: the currently deployed binary never writes the new values and
-- ignores the new column. Enum additions cannot be used in the transaction
-- that adds them, which is why nothing here references them.

ALTER TYPE ai_overage_charge_status ADD VALUE IF NOT EXISTS 'requires_action';
ALTER TYPE ai_overage_charge_status ADD VALUE IF NOT EXISTS 'voided';
ALTER TYPE ai_overage_charge_status ADD VALUE IF NOT EXISTS 'uncollectible';

ALTER TYPE ai_credit_reload_status ADD VALUE IF NOT EXISTS 'requires_action';
ALTER TYPE ai_credit_reload_status ADD VALUE IF NOT EXISTS 'voided';
ALTER TYPE ai_credit_reload_status ADD VALUE IF NOT EXISTS 'uncollectible';

ALTER TABLE ai_overage_charge ADD COLUMN IF NOT EXISTS hosted_invoice_url TEXT;
ALTER TABLE ai_credit_reload ADD COLUMN IF NOT EXISTS hosted_invoice_url TEXT;
