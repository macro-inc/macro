-- Who signed a Macro computer's Claude Code in through Macro, and when; both
-- are set with claude_mode = 'own_account' and cleared on sign-out.
-- capabilities_reported_at is when macrod last reported capabilities, so a
-- report older than the sign-in is not mistaken for its outcome.
ALTER TABLE public.harnesses
    ADD COLUMN claude_signed_in_by text,
    ADD COLUMN claude_signed_in_at timestamptz,
    ADD COLUMN capabilities_reported_at timestamptz;

-- The last expiry notice the control plane sent for the computer's Claude
-- sign-in: its stage, and the sign-in and expiry it applied to. A notice for
-- an older sign-in no longer counts, so a new sign-in starts over.
ALTER TABLE public.hosted_runtime
    ADD COLUMN claude_notice_stage text
        CHECK (claude_notice_stage IN ('expires_soon', 'expires_today', 'expired')),
    ADD COLUMN claude_notice_signed_in_at timestamptz,
    ADD COLUMN claude_notice_expires_at timestamptz,
    ADD CONSTRAINT hosted_runtime_claude_notice_complete
        CHECK ((claude_notice_stage IS NULL) = (claude_notice_signed_in_at IS NULL));
