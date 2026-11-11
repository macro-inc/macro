-- Macro computers' sign-in state comes from harnessd's status, written to
-- harness_account_logins under a per-computer lock, so nothing reports or
-- reads harness capabilities any more. Claude's setup-token credential names
-- no account, so provider accounts carry no display details either.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.harnesses
    DROP COLUMN capabilities,
    DROP COLUMN capabilities_reported_at;

ALTER TABLE public.provider_accounts
    DROP COLUMN display_email,
    DROP COLUMN display_org,
    DROP COLUMN plan;
