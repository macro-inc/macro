# Catalog

The registry is every app in `registry/apps/`. The Connect API serves only
`status = "live"` entries in the public catalog; customers render those.
The first live slice is Linear, Notion, PostHog, and Sentry. Other entries
remain pending until they pass conformance.

## What belongs

An app enters the catalog only when the vendor runs its own remote MCP server
and Macro Connect can obtain an OAuth client for it (`cimd`, `dcr`, or an
approved `own_app`). API-key-only vendors enter only when the vendor offers no
OAuth at all. Pipedream-style servers built on a vendor's API never enter.

An app whose `own_app` is still in review is registered with
`status = "pending"`: listed nowhere until approved.

## `app.toml`

```toml
id = "notion"                       # stable; matches the directory name
name = "Notion"
description = "Search, read, and edit pages and databases."
access = ["mcp"]                    # ["mcp"] or ["mcp", "api"]
mcp_url = "https://mcp.notion.com/mcp"
client_registration = "dcr"         # cimd | dcr | own_app | api_key
scopes = []                         # only when the server needs explicit scopes
pipedream_app_slugs = ["notion"]    # Pipedream apps this replaces, for migration
status = "live"                     # live | pending
probed = 2026-10-30                 # last probe date; see probing.md
```

Field rules:

- `description`: one line, what the agent can do once connected, written from
  the server's own `tools/list` (many servers list tools before sign-in).
  Plain verbs, no marketing.
- `access`: the catalog shows `MCP` or `MCP + API` from this.
- `scopes`: Linear needs `["read", "write"]`: with no scope requested it
  records the approval as empty but grants write, and the flow fails after the
  user approves.
- `own_app` apps name their Doppler secrets `<ID>_CLIENT_ID` and
  `<ID>_CLIENT_SECRET` in project `connect-api`. They may list the scopes
  granted by their registered app; Slack lists its user scopes explicitly.
- Two apps may share an `mcp_url` (Jira and Confluence share Atlassian's
  server); each keeps its own entry so migration maps each Pipedream app.

## `icon.svg`

Square, single file, under 10 KB, from Simple Icons when the brand is there,
otherwise the vendor's press kit. Use the vendor's mark unaltered.

## Starting set

[`research/vendor-auth.csv`](research/vendor-auth.csv) holds the probed apps
with Macro's Pipedream connection counts. Rows with `custom_oauth_app = no`
and a vendor `mcp_url` are the day-1 registry, except Exa, Mailchimp, Zendesk,
HighLevel, Raindrop, and Apify, which each need a conformance pass first
(odd metadata or unconfirmed official status; notes in the CSV).
