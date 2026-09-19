-- Opt-in for external agents (MCP clients) to send email from an inbox.
-- Off by default: agents can always save drafts, but only send when the
-- inbox owner turns this on in Settings.
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS mcp_send_enabled BOOLEAN NOT NULL DEFAULT FALSE;
