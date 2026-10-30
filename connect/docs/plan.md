# Macro Connect plan

Macro Connect gives products first-party access to their users' tools: it
connects users to each vendor's own MCP server over the vendor's OAuth, through
OAuth apps Macro Connect owns and operates. Macro is its first customer; it
replaces Pipedream Connect, which charges Macro $2 per user per month, owns the
OAuth grants, and often falls back to API keys or its own API wrappers.

Current state lives in [`../STATUS.md`](../STATUS.md); decisions and their
reasons in [`decisions.md`](decisions.md).

## Guarantees

1. **First-party MCP.** Every connector is the vendor's own MCP server. A
   wrapper over a vendor's API is never presented as MCP.
2. **OAuth whenever the vendor offers it.** API keys only for vendors with no
   OAuth (Anthropic, OpenAI, Cursor, Firecrawl, Telegram).
3. **Customers own their users.** Grants are exportable; a customer can bring
   its own OAuth app for any vendor.
4. **Honest labels.** The catalog says, per connector, `MCP` or `MCP + API`.

## Scope

**v1 (week one): Macro's own users, MCP only.** Every Macro user connects
through Macro Connect for each app in the catalog. Pipedream stays for
Google (punted) and apps still waiting on vendor review, and is cancelled when
the last one moves.

**Later:** API access next to MCP (`MCP + API`), other companies as customers
(their own OAuth apps, token export, billing), a public catalog site.

Out of scope for v1: apps with no first-party MCP server. At the 2026-10-30
measurement they held 451 of Macro's 4,057 Pipedream connections (LinkedIn,
Spotify, Google Forms, YouTube, Pinterest, QuickBooks, API-key apps, and
Microsoft, whose MCP servers need Agent 365 licences). They stay on Pipedream
until cutover, then are removed.

## Product boundary

Macro Connect lives in `connect/` but is built as if it were its own
repository; see [`../AGENTS.md`](../AGENTS.md#boundary). Macro integrates
through Macro Connect's public surface only, the way any customer would:

- Rust: the `connect_client` crate.
- Web: the `@macro-connect/sdk` package (catalog and the hosted connect flow).

Macro's own `mcp_client` keeps serving custom MCP servers a user adds by URL;
the Pipedream integration (`pipedream_mcp`) is replaced by an adapter over
`connect_client` behind the same ports.

## Architecture

| Part | Where | Does |
| --- | --- | --- |
| Registry | `connect/registry/apps/<id>/` | One directory per app: `app.toml` (name, description, MCP URL, access, client registration, scopes, Pipedream slugs it replaces) and `icon.svg`. Source of truth for the catalog. |
| Connect API | `connect/services/connect_api` | Catalog, connect flow (authorize, callback), connection list and delete, token export. Its own Postgres database and Doppler project. |
| MCP gateway | in `connect_api` | Per-connection MCP endpoint: injects the vendor token, refreshes it, forwards to the vendor's server. Customers call this, as Macro called Pipedream's remote MCP. |
| OAuth client | `connect/crates/` | Client registration in order: CIMD, DCR, then Macro Connect's own OAuth app. Ported from Macro's `mcp_client`, which already does all three. |
| Token store | `connect_api` database | Grants stored as KMS ciphertext bound to the connection (Macro rule CS-72). |
| Ops agents | `connect/.agents/skills/` | Probing, conformance, catalog authoring, submissions, project management. |

Client registration per app comes from probing the server, never from docs
alone: [`probing.md`](probing.md).

## Week one

Target: 2026-11-06. Vendor reviews run in parallel from day 1 and are the long
pole; engineering does not wait on them.

| Day | Engineering | Vendors and operations |
| --- | --- | --- |
| 1 | Boundary checks (ast-grep, Cargo dependency check). Registry format; generate entries from [`research/vendor-auth.csv`](research/vendor-auth.csv). `connect_api` skeleton, database, Doppler project. | File every submission: [`../submissions/`](../submissions/). Create `connect@macro.com`, the Macro Connect landing, privacy, and terms pages. |
| 2 | Catalog endpoint. Connect flow with CIMD, DCR, and own-app registration. Encrypted token store. | Test accounts for the top 20 apps. |
| 3 | MCP gateway with token refresh. Conformance test per app: connect, refresh, list tools, one read-only call. | Prober and conformance runs scheduled nightly. |
| 4 | `connect_client` and `@macro-connect/sdk`. Macro adapter replacing `pipedream_mcp`; Macro web catalog and connect flow on the SDK. | Answer reviewer mail same day. |
| 5 | Deploy `connect_api` (needs the human's approval). Macro behind a feature flag: internal users, then 10%. | |
| 6-7 | 100% for catalog apps. Reconnect prompts; delete each user's Pipedream account once they reconnect. | Daily human queue. |

After week one: the marketplace apps (Zoom, Xero, Box) as reviews pass, then
Google when Eric reopens it (verification, plus CASA for Gmail, Drive, and
Chat). Microsoft is excluded.

## Coverage at launch

From [`research/vendor-auth.csv`](research/vendor-auth.csv) (Pipedream
connections, 2026-10-30):

| Group | Connections | Path |
| --- | --- | --- |
| Server registers our client (CIMD or DCR) | 1,198 | Day 1 registry |
| Own OAuth app already registered: Macro's GitHub and Slack apps (Connect's own later), HubSpot and Asana to confirm | 608 | Day 1 registry |
| Google, first-party MCP | 1,612 | Punted; stays on Pipedream |
| Own-app vendors under review or allowlist (Figma, Zoom, Xero, Discord, Vercel, Box) | 102 | As approved |
| No first-party MCP, or Microsoft (excluded: needs Agent 365 licences) | 451 | Removed at cutover (confirmed) |

3,973 of 4,057 connections are classified; the rest are apps with one
connection each.

Users who connected through Pipedream's own OAuth apps must reconnect;
Pipedream does not export those grants.

## Risks

- **Vendor review time.** Google CASA takes weeks to months; marketplace
  reviews take weeks. Mitigation: file on day 1, ask for the narrowest scopes,
  answer reviewers the same day.
- **Serving other companies' users through our OAuth apps.** Google Limited
  Use, Slack, and LinkedIn terms restrict passing user data to third parties.
  Before external customers: legal review, and default them to their own OAuth
  apps.
- **Reconnect churn.** Every migrated user signs in again per app.
- **Human-only steps.** Legal attestations, identity checks, payments, 2FA,
  CAPTCHAs, and deploys need a person; the human queue batches them daily.
