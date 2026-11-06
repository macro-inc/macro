-- How Claude Code on a Macro computer is paid for: Macro credits through the
-- Anthropic gateway, or a Claude account signed in on the computer itself.
-- Written when macrod confirms a sign-in or sign-out.
ALTER TABLE public.harnesses
    ADD COLUMN claude_mode text NOT NULL DEFAULT 'macro_credits'
        CHECK (claude_mode IN ('macro_credits', 'own_account'));
