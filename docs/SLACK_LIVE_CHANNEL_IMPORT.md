# Live Slack channel import: MCP contract investigation

## Purpose and evidence status

This contract supports importing the names and matched participants of selected
public Slack channels through the existing Pipedream connection. Messages, files,
ongoing sync, private channels, DMs, and the separate ZIP-archive importer are out
of scope. The selected read mechanism is Pipedream remote MCP, not Connect Proxy.

**Dev access unavailable.** The local Doppler CLI could not retrieve
`PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, and `PIPEDREAM_PROJECT_ID` from
project `document-cognition`, config `dev` (exit status 1; access-token diagnostic).
No credentials were loaded or persisted. No Pipedream token was minted, no live
Slack tool was called, and no dev database was queried. A dev external user and
their connected Slack workspace could not be established. Raw CLI output was
withheld to avoid exposing credentials.

The files below are **synthetic fallback fixtures, not recordings**. They let
adapter tests start without dev access; passing those tests does not establish
Pipedream compatibility. Live verification remains a release prerequisite.

## Slug decision

Canonical slug: `slack` (unverified fallback; retain until dev evidence supports `slack_v2`).

| Evidence | `slack` | `slack_v2` |
| --- | --- | --- |
| `GET /v1/connect/apps/{slug}` existence | Not checked | Not checked |
| Catalog `auth_type` | Unknown | Unknown |
| Hosted Connect UI account slug | Unknown | Unknown |
| Dev `pipedream_mcp_connections.app_slug` rows | Not queried | Not queried |

Do not migrate existing rows or change the new-connection slug based on the
synthetic tool names. Treat both slugs as potential Slack aliases. Switch the
canonical slug to `slack_v2` only after verifying that it exists and that accounts
created by hosted Connect use it. Account app slugs and action-name prefixes are
separate facts; a `slack_v2-*` tool name alone is not that evidence.

## Tool contract: provisional, not observed

`tools_list.json` contains a synthetic MCP `ListToolsResult` with the three
candidate action names from the implementation plan. Its `inputSchema` objects
model Slack Web API arguments; they are **not exact Pipedream schemas**.

| Candidate tool | Synthetic arguments | Still requires verification |
| --- | --- | --- |
| `slack_v2-list-channels` | Optional string `cursor`, integer `limit`, comma-separated string `types`, boolean `exclude_archived` | Exact name, supported properties, defaults, string vs array types |
| `slack_v2-list-members-in-channel` | Required string `channel`; optional `cursor`, `limit` | Channel argument name/shape and whether pagination is exposed |
| `slack_v2-list-users` | Optional `cursor`, `limit` | Exact schema, pagination, email scope, output completeness |

Resolve tools from the actual session's `tools/list`; do not blindly send these
provisional arguments or invent an unsupported cursor. An action may paginate
internally or expose an aggregate-result limit rather than a Slack page size.

### Envelopes, pagination, and directory data

The three `list_*.json` files are synthetic MCP `CallToolResult` objects, without
the outer JSON-RPC `id`/`result` wrapper. Each has `isError: false` and one
`content` entry whose `type` is `text` and whose `text` is JSON:

- Channels: `{ "ok": true, "channels": [...], "response_metadata": { "next_cursor": "" } }`.
  Includes one public and one private channel to exercise filtering, not as a
  claim about the defaults of the live action.
- Members: `{ "ok": true, "members": ["U..."], "response_metadata": { "next_cursor": "synthetic-next-page" } }`.
  The nonempty cursor deliberately represents an incomplete page; it is not a
  usable upstream token or evidence that Pipedream returns cursors.
- Users: `{ "ok": true, "members": [...], "response_metadata": { "next_cursor": "" } }`.
  Includes an active human with `profile.email`, a bot without an email, and a
  deleted human. IDs are consistent across these fixtures; all emails use
  `example.com`.

Live text versus `structuredContent`, wrappers such as `ret`, bare arrays,
`response_metadata.next_cursor`, and internal auto-pagination are **unknown**.
The synthetic empty cursors do not prove complete live results. No real
`list-users` call was possible, so output truncation and maximum workspace size
are untested. `profile.email`, `is_bot`, and `deleted` are plausible Slack Web API
fields, not confirmed Pipedream output. In particular, email availability depends
on the connected account's permissions (including `users:read.email`).

| Measurement | Result |
| --- | --- |
| Per-call latency (channels / members / users) | Not measured; no live calls |
| Rate-limit error text / HTTP 429 / `Retry-After` | Not observed; no live calls |
| Directory truncation | Not tested on a real workspace |

## What the adapter must tolerate

- Both connection slugs, without assuming the action-name prefix equals the slug.
- Missing or renamed tools and changed argument schemas: report unsupported
  capability rather than treating it as an empty workspace.
- JSON text content and structured results; recognized wrapper objects or arrays
  only. Unknown envelopes, malformed JSON, truncation, and non-JSON prose must
  not silently become successful empty lists.
- MCP `isError`, JSON-RPC errors, HTTP failures, and Slack `ok: false` separately
  from valid empty data. Missing scopes and expired connections need actionable
  errors, not empty membership.
- Cursor pagination where exposed, with bounded pages, repeated-cursor detection,
  and deduplication. An omitted cursor from an internally paginated action is not
  proof of completeness until that action's contract is verified. Flag incomplete
  membership instead of claiming everyone was resolved.
- Rate limits surfaced at either transport or action level. Honor `Retry-After`
  when available, bound retries, and preserve partial-resolution status rather
  than retrying indefinitely. No exact upstream error text is asserted here.
- Missing/null profile or email, bots, deleted users, duplicate user IDs, and
  member IDs absent from the directory. Do not manufacture email addresses or
  invite unmatched users; use the existing Macro team-roster matcher.
- Public/private/IM/MPIM flags and archived channels. Never stage unsupported
  kinds simply because their ID begins with `C`; private channels may use it too.
- Large directories and long-running actions: enforce time/output budgets and
  distinguish truncation from complete results. Preserve total member counts
  independently of any stored-participant cap.

These are adapter requirements, not claims that every variant was observed or
that production handling is implemented by this documentation-only task.

## Read-only live verification procedure

1. Authenticate Doppler outside repository files. Load only the three named
   Pipedream credentials from DCS `document-cognition` / `dev` into the probe's
   process environment. Disable shell tracing; never print or persist secrets,
   authorization headers, account credentials, or raw user data.
2. Match `PipedreamClient::access_token` in
   `crates/pipedream_mcp/src/outbound/api.rs`: POST form-encoded
   `grant_type=client_credentials`, `client_id`, and `client_secret` to
   `https://api.pipedream.com/v1/oauth/token`. Keep the bearer only in memory.
3. GET `/v1/connect/apps/slack` and `/v1/connect/apps/slack_v2` with that bearer;
   record HTTP status, `name_slug`, and `auth_type`, not the whole response.
4. For an authorized dev user with an existing Slack connection, GET
   `/v1/connect/{project_id}/accounts?external_user_id=<dev user>` with
   `x-pd-environment: development`. Record only app slugs and whether the account
   is known to originate in hosted Connect. Existing accounts alone do not prove
   what the current UI creates. Do not create accounts during this read-only
   investigation. If reachable, use a read-only dev DB transaction to select
   distinct `app_slug` values from `pipedream_mcp_connections`, limited to
   `slack` and `slack_v2`; do not export user/account IDs.
5. Speak Streamable HTTP MCP to `https://remote.mcp.pipedream.net`. Match
   `McpUpstream::upstream` with `Authorization: Bearer <token>`,
   `x-pd-project-id`, `x-pd-environment: development`, `x-pd-external-user-id`,
   `x-pd-app-slug` (the verified connected slug), and `x-pd-tool-mode: tools-only`.
   Use `Content-Type: application/json` and accept both `application/json` and
   `text/event-stream`. Send `initialize`, retain any returned session ID and
   negotiated protocol version for subsequent requests, then send
   `notifications/initialized` and `tools/list`. Follow tool-list pagination.
6. Capture exact schemas for the three read-only listing actions. Call only
   those tools with schema-supported arguments, using a channel returned by the
   channel listing. Record per-call elapsed time and actual envelope keys. Test
   small page sizes/cursors if supported and run `list-users` on a real workspace
   to check complete JSON, output caps, and email/bot/deleted fields. Do not
   deliberately provoke rate limits; record any naturally encountered errors.
7. Replace the synthetic fixtures with redacted live results under 50 KB each.
   Replace all names, emails, workspace/user/channel IDs, cursors, URLs, purpose
   text, and other user content with synthetic values while preserving structure
   and cross-fixture identity relationships. If arrays must be sampled to meet
   the size budget, document sampling separately from upstream truncation.
   Update the evidence tables, exact tool schemas, and canonical-slug decision.

## Fixture checks

```sh
ls crates/import/src/outbound/mcp_slack_source/fixtures/
jq . crates/import/src/outbound/mcp_slack_source/fixtures/*.json
grep -n "Canonical slug" docs/SLACK_LIVE_CHANNEL_IMPORT.md
grep -rn "@" crates/import/src/outbound/mcp_slack_source/fixtures/ | grep -v example.com
```

The final pipeline should emit nothing (exit status 1 means no matching lines).
Also parse each text content entry as JSON, check individual file sizes, and
review all string values; the email grep alone is not a redaction audit.
