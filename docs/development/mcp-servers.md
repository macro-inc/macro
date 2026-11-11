# Agent MCP servers

The repository registers its MCP servers once per harness: `.mcp.json` (Claude
Code), `.cursor/mcp.json` (Cursor) and `opencode.json` (opencode). Add or change
a server in all three. Local commands such as `goalert-mcp-macro` come from the
Nix dev shell, so start the harness inside `nix develop`.

| Server | What it reaches |
| --- | --- |
| `chrome-devtools` | The local agent browser on `127.0.0.1:9222`; see [running locally](running-locally.md#tracing-logs-and-the-debug-browser). |
| `goalert` | Production GoAlert at `https://oncall.macro-internal.com`: alerts, services, on-call, schedules. |
| `grafana` | The local LGTM Grafana on `localhost:3001`. |
| `macro`, `posthog`, `datadog` | Hosted servers that sign in with OAuth. `macro` is Claude Code only, `datadog` opencode only. |

## GoAlert

`goalert-mcp-macro` runs the community
[goalert-mcp](https://github.com/amitray007/goalert-mcp) server, built from a
pinned commit in `nix/cloud-storage.nix`. At launch it reads
`GOALERT_ADMIN_PASSWORD` from Doppler `observability/prd` and signs in as
GoAlert's `admin`, so it needs a Doppler login with access to that project.
Nothing is stored in the repository.

It starts in read-only mode: only list/get tools and a read-only GraphQL query
are exposed. To acknowledge or close alerts in one session, start the harness
with `GOALERT_READ_ONLY=false`, for example
`GOALERT_READ_ONLY=false claude`. Every write is made as `admin` against the
production pager.

To upgrade, review the new source first, then bump `rev`, `hash` and
`npmDepsHash` together.
