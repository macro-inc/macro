# Catalog

The registry is every app in `registry/apps/`. The Connect API serves only
`status = "live"` entries in the public catalog; customers render those.
On 2026-10-31, 30 entries are live OAuth candidates. Entries with vendor gates,
tenant-specific endpoints, or rejected callback URLs remain pending.

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
client_registration = "cimd"        # cimd | dcr | own_app | api_key
scopes = []                         # only when the server needs explicit scopes
pipedream_app_slugs = ["notion"]    # Pipedream apps this replaces, for migration
status = "live"                     # live | pending
probed = 2026-10-31                 # last probe date; see probing.md
```

Field rules:

- `description`: one line, what the agent can do once connected, written from
  the server's own `tools/list` (many servers list tools before sign-in).
  Plain verbs, no marketing.
- `access`: the catalog shows `MCP` or `MCP + API` from this.
- `oauth_client`: the public catalog labels `own_app` as `managed_oauth_app`
  ("Managed OAuth app") and both `cimd` and `dcr` as `dcr` ("DCR"). The
  field is omitted for `api_key` entries.
- `scopes`: Linear needs `["read", "write"]`: with no scope requested it
  records the approval as empty but grants write, and the flow fails after the
  user approves.
- `own_app` apps use encrypted Connect Pulumi `ownAppCredentials` config,
  keyed by app id with `clientId` and `clientSecret`. The standalone stack
  injects `<ID>_CLIENT_ID` and `<ID>_CLIENT_SECRET` through its own Secrets
  Manager runtime secret only when the app is live. They may list the scopes
  granted by their registered app; Slack lists its user scopes explicitly.
- Two apps may share an `mcp_url` (Jira and Confluence share Atlassian's
  server); each keeps its own entry so migration maps each Pipedream app.

## `icon.svg`

Square, single file, under 10 KB, from Simple Icons when the brand is there,
otherwise the vendor's press kit. Use the vendor's mark unaltered.

## Coverage source

[`research/vendor-auth.csv`](research/vendor-auth.csv) records Pipedream
connection counts. The dated table below records the current OAuth probes and
which used apps are available in the catalog. Vercel and Raindrop remain out of
the registry while vendor client gates prevent Connect from registering.

## Conformance, 2026-10-31

`candidate` means OAuth metadata was available and DCR accepted the Connect callback where applicable. Full sign-in, refresh, tool listing, and a read-only call still require a vendor test account; CIMD acceptance requires the dev deployment. The URLs in each row are the requests used for the OAuth probe.

| App | Connections | Registration | Result | Notes |
| --- | ---: | --- | --- | --- |
| airtable | 23 | `dcr` | `candidate` | Verified on dev with DCR: consent, 55 tools, `list_bases`. CIMD is advertised, but after sign-in Airtable rejected our CIMD client (`invalid client_id or mismatched redirect_uri`). [MCP 401](https://mcp.airtable.com/mcp) · [PRM 200](https://mcp.airtable.com/.well-known/oauth-protected-resource) · [AS 200](https://airtable.com/.well-known/oauth-authorization-server/oauth2/v1) |
| apify | 1 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://mcp.apify.com) · [PRM 200](https://mcp.apify.com/.well-known/oauth-protected-resource) · [AS 200](https://console-backend.apify.com/.well-known/oauth-authorization-server) |
| apollo | 9 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://mcp.apollo.io/mcp) · [PRM 200](https://mcp.apollo.io/.well-known/oauth-protected-resource) · [AS 200](https://mcp.apollo.io/.well-known/oauth-authorization-server) |
| attio | 8 | `dcr` | `candidate` | DCR accepted Connect callback (HTTP 201). [MCP 401](https://mcp.attio.com/mcp) · [PRM 200](https://mcp.attio.com/.well-known/oauth-protected-resource) · [AS 200](https://app.attio.com/.well-known/oauth-authorization-server) |
| calendly | 18 | `dcr` | `candidate` | Authorize page reached on dev; Google signup returns to login without creating an account. Unresolved. [MCP 401](https://mcp.calendly.com) · [PRM 200](https://mcp.calendly.com/.well-known/oauth-protected-resource) · [AS 200](https://calendly.com/.well-known/oauth-authorization-server) |
| canva | 3 | `cimd` | `broken` | Dev authorize returned 400 `Invalid redirect URI.` for our CIMD client: Canva accepts only redirect URIs it has approved. [MCP 401](https://mcp.canva.com/mcp) · [PRM 200](https://mcp.canva.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.canva.com/.well-known/oauth-authorization-server) |
| clickup | 15 | `dcr` | `candidate` | Verified on dev: consent (workspace picker), 67 tools, `clickup_get_workspace_hierarchy`. [MCP 401](https://mcp.clickup.com/mcp) · [PRM 200](https://mcp.clickup.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.clickup.com/.well-known/oauth-authorization-server) |
| cloudflare | 9 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://mcp.cloudflare.com/mcp) · [PRM 200](https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.cloudflare.com/.well-known/oauth-authorization-server) |
| coda | 4 | `dcr` | `broken` | Direct DCR accepted Connect callback (HTTP 201), but local Connect authorization returned 502 `oauth_failed` during client registration. [MCP 401](https://coda.io/apis/mcp) · [PRM 200](https://coda.io/.well-known/oauth-protected-resource/apis/mcp) · [AS 200](https://coda.io/.well-known/oauth-authorization-server) |
| confluence | 4 | `cimd` | `candidate` | Verified on dev: consent and 41 tools; reads need a site with Confluence (test site has Jira only). Same Atlassian admin allowlist step as Jira. [MCP 401](https://mcp.atlassian.com/v1/mcp/authv2) · [PRM 200](https://mcp.atlassian.com/.well-known/oauth-protected-resource/v1/mcp/authv2) · [AS 200](https://auth.atlassian.com/.well-known/oauth-authorization-server/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3) |
| datadog | 3 | `dcr` | `tenant` | Site-specific MCP endpoint and optional organization subdomain; preview toolsets require approval. Current registry URL now uses US1 `/v1/mcp`. Old `/mcp` returned 404. [MCP 401](https://mcp.datadoghq.com/v1/mcp) · [PRM 200](https://mcp.datadoghq.com/.well-known/oauth-protected-resource/v1/mcp) · [AS 200](https://mcp.datadoghq.com/.well-known/oauth-authorization-server/v1/mcp) |
| dropbox | 10 | `dcr` | `blocked` | DCR POST returned 403 `registration_not_supported` despite advertised endpoint. [MCP 401](https://mcp.dropbox.com/mcp) · [PRM 200](https://mcp.dropbox.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://www.dropbox.com/.well-known/oauth-authorization-server) |
| exa | 7 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 200](https://mcp.exa.ai/mcp) · [PRM 200](https://mcp.exa.ai/.well-known/oauth-protected-resource/mcp) · [AS 200](https://auth.exa.ai/.well-known/oauth-authorization-server) |
| fathom | 3 | `dcr` | `candidate` | DCR accepted Connect callback (HTTP 201). [MCP 401](https://api.fathom.ai/mcp) · [PRM 200](https://api.fathom.ai/.well-known/oauth-protected-resource/mcp) · [AS 200](https://api.fathom.ai/.well-known/oauth-authorization-server) |
| granola | 21 | `cimd` | `candidate` | Verified on dev: consent and 7 tools; tool calls need a Granola account, created only in its desktop app. [MCP 401](https://mcp.granola.ai/mcp) · [PRM 200](https://mcp.granola.ai/.well-known/oauth-protected-resource) · [AS 200](https://mcp-auth.granola.ai/.well-known/oauth-authorization-server) |
| highlevel | 3 | `dcr` | `candidate` | DCR accepted Connect callback (HTTP 201). [MCP 401](https://services.leadconnectorhq.com/mcp/) · [PRM 200](https://services.leadconnectorhq.com/mcp/.well-known/oauth-protected-resource/mcp) · [AS 200](https://services.leadconnectorhq.com/.well-known/oauth-authorization-server/mcp) · [MCP no-slash 401](https://services.leadconnectorhq.com/mcp) |
| intercom | 2 | `dcr` | `broken` | DCR POST rejected Connect callback: 400 `invalid_redirect_uri`. [MCP 401](https://mcp.intercom.com/mcp) · [PRM 200](https://mcp.intercom.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.intercom.com/.well-known/oauth-authorization-server) |
| jira | 15 | `cimd` | `candidate` | Verified on dev: consent, 41 tools, `getAccessibleAtlassianResources`. Each Atlassian org admin must add `https://<connect-host>/**` under Admin → Connectors → Atlassian MCP server, or consent shows "Access to this domain is restricted". [MCP 401](https://mcp.atlassian.com/v1/mcp/authv2) · [PRM 200](https://mcp.atlassian.com/.well-known/oauth-protected-resource/v1/mcp/authv2) · [AS 200](https://auth.atlassian.com/.well-known/oauth-authorization-server/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3) |
| klaviyo | 2 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://mcp.klaviyo.com/mcp) · [PRM 200](https://mcp.klaviyo.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.klaviyo.com/.well-known/oauth-authorization-server) |
| linear | 229 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://mcp.linear.app/mcp) · [PRM 200](https://mcp.linear.app/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.linear.app/.well-known/oauth-authorization-server) |
| mailchimp | 5 | `dcr` | `candidate` | DCR accepted Connect callback (HTTP 200). [MCP 401](https://ai-inc.mailchimp.com/claude/mcp/v2) · [PRM 200](https://ai-inc.mailchimp.com/.well-known/oauth-protected-resource/claude) · [AS 200](https://ai-inc.mailchimp.com/.well-known/oauth-authorization-server/claude) |
| monday | 1 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://mcp.monday.com/mcp) · [PRM 200](https://mcp.monday.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://auth.monday.com/.well-known/oauth-authorization-server/mcp) |
| netlify | 11 | `dcr` | `candidate` | Authorize page reached on dev; clicking Authorize stalls in the test browser and never redirects. Unresolved. [MCP 401](https://netlify-mcp.netlify.app/mcp) · [PRM 200](https://netlify-mcp.netlify.app/.well-known/oauth-protected-resource/mcp) · [AS 200](https://netlify-mcp.netlify.app/.well-known/oauth-authorization-server) |
| notion | 683 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://mcp.notion.com/mcp) · [PRM 200](https://mcp.notion.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.notion.com/.well-known/oauth-authorization-server) |
| paypal | 1 | `dcr` | `candidate` | DCR accepted Connect callback (HTTP 201). [MCP 401](https://mcp.paypal.com/mcp) · [PRM 200](https://mcp.paypal.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.paypal.com/.well-known/oauth-authorization-server) |
| pipedrive | 3 | `dcr` | `broken` | DCR POST rejected Connect callback: 400 `invalid_redirect_uri`. [MCP 401](https://mcp.pipedrive.ai/mcp) · [PRM 200](https://mcp.pipedrive.ai/mcp/.well-known/oauth-protected-resource) · [AS 200](https://oauth.pipedrive.com/.well-known/oauth-authorization-server) |
| posthog | 11 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://mcp.posthog.com/mcp) · [PRM 200](https://mcp.posthog.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://oauth.posthog.com/.well-known/oauth-authorization-server) |
| quo | 6 | `dcr` | `candidate` | DCR accepted Connect callback (HTTP 201). [MCP 401](https://mcp.quo.com/mcp) · [PRM 200](https://mcp.quo.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.quo.com/.well-known/oauth-authorization-server) |
| raindrop | 5 | `dcr` | `blocked` | DCR POST returned 400: `Only pre-registered clients are allowed to use DCR`; Pro plan required. [MCP 401](https://api.raindrop.io/rest/v2/ai/mcp) · [PRM 200](https://api.raindrop.io/.well-known/oauth-protected-resource) · [AS 200](https://api.raindrop.io/.well-known/oauth-authorization-server) |
| sentry | 3 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://mcp.sentry.dev/mcp) · [PRM 200](https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.sentry.dev/.well-known/oauth-authorization-server) |
| shopify | 7 | `cimd` | `tenant` | Global endpoint exposes unauthenticated tools; merchant account and authorization resource need tenant-specific discovery. [MCP 200](https://mcp.shopify.com/mcp) · [PRM 200](https://mcp.shopify.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://setup.shopify.com/.well-known/oauth-authorization-server/auth) |
| square | 2 | `dcr` | `broken` | DCR POST rejected Connect callback: 400 `invalid_redirect_uri`. [MCP 401](https://mcp.squareup.com/mcp) · [PRM 200](https://mcp.squareup.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.squareup.com/.well-known/oauth-authorization-server) |
| stripe | 11 | `dcr` | `candidate` | Authorize page reached on dev; finishing test-account signup needs a human (CAPTCHA). [MCP 401](https://mcp.stripe.com) · [PRM 200](https://mcp.stripe.com/.well-known/oauth-protected-resource) · [AS 200](https://access.stripe.com/.well-known/oauth-authorization-server/mcp) |
| supabase | 8 | `dcr` | `candidate` | DCR accepted Connect callback (HTTP 201). [MCP 401](https://mcp.supabase.com/mcp) · [PRM 200](https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://api.supabase.com/.well-known/oauth-authorization-server) |
| todoist | 21 | `cimd` | `candidate` | Verified on dev: consent, 47 tools, `find-projects`. [MCP 401](https://ai.todoist.net/mcp) · [PRM 200](https://ai.todoist.net/.well-known/oauth-protected-resource/mcp) · [AS 200](https://todoist.com/.well-known/oauth-authorization-server) |
| trello | 23 | `cimd` | `broken` | Dev consent succeeds, but `mcp.trello.com/v1` serves the Atlassian Rovo server with Jira and Confluence tools only (41, none for Trello), even for an account with Trello. [MCP 401](https://mcp.trello.com/v1) · [PRM 200](https://mcp.trello.com/.well-known/oauth-protected-resource/v1) · [AS 200](https://auth.atlassian.com/.well-known/oauth-authorization-server/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3) |
| typeform | 1 | `cimd` | `candidate` | CIMD advertised; dev client-ID acceptance pending. [MCP 401](https://api.typeform.com/mcp) · [PRM 200](https://api.typeform.com/.well-known/oauth-protected-resource) · [AS 200](https://api.typeform.com/.well-known/oauth-authorization-server) |
| vercel | 5 | `cimd` | `blocked` | Vendor requires client review before use; pending approval despite advertised CIMD/DCR. [MCP 401](https://mcp.vercel.com) · [PRM 200](https://mcp.vercel.com/.well-known/oauth-protected-resource) · [AS 200](https://vercel.com/.well-known/oauth-authorization-server) |
| webflow | 5 | `dcr` | `candidate` | DCR accepted Connect callback (HTTP 201). [MCP 401](https://mcp.webflow.com/mcp) · [PRM 200](https://mcp.webflow.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.webflow.com/.well-known/oauth-authorization-server) |
| zendesk | 2 | `cimd` | `tenant` | OAuth metadata is on the global host, but account MCP access needs the Zendesk subdomain; official endpoint status remains unconfirmed. [MCP 401](https://mcp.zendesk.com/mcp) · [PRM 200](https://mcp.zendesk.com/.well-known/oauth-protected-resource/mcp) · [AS 200](https://mcp.zendesk.com/.well-known/oauth-authorization-server/mcp/oauth) |

New icon sources: [Exa brand assets](https://exa.ai/brand),
[HighLevel brand kit](https://marketing.gohighlevel.com/brandkit),
[Apify's SVG favicon](https://apify.com/favicon.svg), and
[Simple Icons 16.36.0](https://github.com/simple-icons/simple-icons/tree/16.36.0/icons)
for Mailchimp and Zendesk.
