-- Record which known product the client in `triggered_via` was verified as.
--
-- The public MCP's OAuth broker recognizes a client (Claude, Claude Code,
-- ChatGPT, ...) only when its registered redirect URIs are consistent with the
-- product it names, so clients can show that product's mark on the post
-- instead of a letter. Values are `mcp_client_label::McpClientKind` names.
--
-- Nullable with no default: unrecognized clients and every other message leave
-- it NULL, and the column adds without a table rewrite or backfill.
SET lock_timeout = '5s';

ALTER TABLE public.comms_messages
    ADD COLUMN IF NOT EXISTS triggered_via_kind text;
