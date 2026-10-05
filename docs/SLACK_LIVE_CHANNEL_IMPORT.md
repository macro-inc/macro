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

## Verified behaviour

### Automated integration verification (2026-10-05)

These results validate the integrated code, **not the live Pipedream contract**.
Tests used synthetic MCP fixtures, fake domain ports, and the existing local
Postgres database, which already included the manual-initiator migration. No
hosted database was queried or reset. Rust commands used the installed toolchain
and cached dependencies (`CARGO_NET_OFFLINE=true`); Nix was unavailable.
`SQLX_OFFLINE` was unset for every test command. Database tests used the local URL
from `tooling/just/database.just` via `DATABASE_URL`.

| Check | Result |
| --- | --- |
| `cargo test -p import -p mcp_select -p onboarding -p ai_tools -p channels -p pipedream_mcp` | Passed: 455 tests (114 import, 5 mcp_select, 6 onboarding, 47 ai_tools, 267 channels, 16 pipedream_mcp). Initial attempt lacked `DATABASE_URL`; rerun against local Postgres passed. |
| `cargo test -p slack_integration --features ledger` | Passed: 100 tests, including the archive adapter's new fail-closed error-mapping regression. |
| `just rust-check` | Passed after fixing the archive ledger's exhaustive match for the new `UnsupportedDiscovery` error. Archive import policy is unchanged. |
| `just check full` / `just check` | Wrapper cannot discover changes in this non-colocated jj workspace: its Git commands fail and it exits 0 having checked nothing. Not counted as a pass. Component checks below were run directly. |
| `cargo fmt --check`; `just clippy` | Passed; Clippy covers the workspace and the separate sync-service invocation. |
| Biome CI, oxlint, ast-grep on files changed since the task base, selected with `jj diff` | Passed (exit 0). Warnings: picker metadata-parser complexity; pre-existing domain-to-inbound toolset import in `import/src/domain/service.rs`. Neither was expanded by the integration fix. |
| `bun run check` in `apps/web` | Passed with `NODE_OPTIONS=--max-old-space-size=12288`; the default 4 GB Node heap exhausted memory. Includes schema checks, TypeScript, and Biome. |
| `bun run test` in `apps/web` | Passed with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 TZ=UTC`: 1,408 files, 12,539 tests, 1 todo, 168.53 s. Initial host-locale run had 32 failures in reminder/date/calendar tests; locale/timezone normalization required no code changes. |
| Focused Slack connection, slug, picker-model, and picker-component tests | Passed: 4 files, 38 tests, 1.39 s. |
| `bun run gen-api --check` | All 14 services generated successfully; final Git diff step failed in the jj-only workspace (script exit 1). Independent `jj diff` confirmed no generated-file changes, including cognition OpenAPI, client, metadata, and tool schemas. |

The automated coverage exercises public-only discovery, onboarding top-15
selection, manual discovery including archived candidates, bounded pagination,
100-channel enrichment, roster matching, retry/fallback behavior, manual-run
concurrency, canonical target reuse, import-time member refresh, endpoint
validation, both Slack slug aliases, picker selection, and progress rendering.
It does not prove that a real Pipedream action has the fixture's schema or returns
complete data.

The inherited ancestry contains exactly one nonempty commit for each task
T01–T12, without conflicts. The requested bookmark is absent locally, and this
jj version uses `bookmarks(...)`, not `bookmark(...)`; verification used
`jj log -r 'c55d9ccc::@'` instead. Bookmark placement and integration remain owned
by the planner runner; no rebase, merge, or bookmark mutation was performed here.

### Browser and latency evidence: still blocked

Nix is not installed, so the prescribed local-stack preflight could not run.
The DCS dev Doppler credential probe still exits 1 (secret output suppressed).
No authenticated dev Slack workspace or full local app stack was available for
this verification. Browser E2E was **not performed**. The following remain release
gates, not successful observations:

1. Connect Slack through Pipedream development; verify the live slug, tool
   schemas, email availability, and pagination using the procedure above.
2. Settings → Connections → Slack → Import channels → Find channels: compare
   displayed match counts with the team roster, select two channels, import,
   then open both links and verify names, Team kind, and matched participants.
3. Find channels again: verify no duplicate rows, refreshed counts on staged
   rows, and already-imported rows remaining nonselectable. Check archived
   filtering, empty/error states, and exclusion of private/DM conversations.
4. Onboard a fresh user with Slack connected: verify auto-imported channels
   include matched teammates, without changing onboarding to manual selection.
5. Record channel-list, directory, per-channel member, complete discovery, and
   two-channel import latency with workspace/channel sizes. **No live latency
   was measured**; test durations above are not service latency measurements.

### Known limitations

- `/import/state` returns staged channel metadata together; payload size grows
  with staged channel count. There is no paginated picker-state endpoint.
- Manual discovery enriches members for at most 100 channels, preferring larger
  channels. The remainder stays unresolved until selected for import. Import
  batches attempt fresh resolution with one shared session/directory; failures
  fall back to staged participants, potentially leaving only the importer.
- Best-effort membership enrichment shares a deadline measured from the start
  of discovery: 170 seconds for onboarding, 350 seconds for manual discovery,
  leaving 10 seconds before the outer timeout. Directory/member reads, metadata
  enrichment, and notifications are bounded; expiry keeps staged channels ready
  with unresolved membership instead of failing an otherwise usable discovery.
  Initial listing or staging can still fail or reach the outer timeout.
- Stored matched participants are capped at 100; `member_count` is separate.
  After enrichment it counts known, non-bot, non-deleted directory members, not
  necessarily Slack's displayed total. Unmatched people are not invited.
- Listing/directory/member reads stop at 10/10/5 pages respectively. Exhausting
  those bounds can leave partial data; current service code does not surface
  cursor exhaustion as an explicit incomplete-result state. Repeated cursors
  are bounded by those same limits, not diagnosed separately. Large-workspace
  completeness needs follow-up in discovery/adapter work before broad rollout.
- Private channels (including private `C` IDs), DMs, and group DMs are unsupported.
  Public classification requires explicit `is_private: false`; missing/null or
  malformed visibility is omitted. Where supported, listing tools are requested
  with only the `public_channel` filter.
  Public Slack channels become Macro Team channels, not public Macro channels.
  Any connected team member may import; the importer owns the new channel.
- This is channel shape only: no messages, files, ongoing membership sync, or
  invitation flow. The ZIP-archive feature's authorization and behavior remain
  separate. MCP compatibility and canonical new-connection slug remain
  provisional until the live checks above succeed.

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
