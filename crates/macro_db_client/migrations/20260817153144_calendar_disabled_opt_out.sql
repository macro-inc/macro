-- An explicit user opt-out of the calendar capability, recorded when the user
-- turns calendar off from settings or the calendar view.
--
-- Google has no per-scope revocation: dropping the calendar scopes from the
-- recorded grant is what stops Macro using them, but the authorization request
-- carries `include_granted_scopes=true`, so any later Gmail consent would hand
-- the calendar scopes back and silently resurrect sync. This stamp fences that
-- path — while it is set, an incidental re-grant keeps calendar off, and only a
-- consent flow that explicitly asked for calendar clears it.
ALTER TABLE email_link_google_scopes
    ADD COLUMN calendar_disabled_at timestamptz;
