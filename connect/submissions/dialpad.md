---
vendor: dialpad
apps: [dialpad]
state: needs-human
portal: https://dialpad.atlassian.net/jira/core/form/0a28b2b0-f87e-40b7-907d-ec2ec998090f
account: connect@macro.com
submitted:
last_contact:
next_action: Eric approves the scope request and the draft below, then an agent files the form
next_action_owner: human
due: 2026-11-04
---

## Why

Macro imports a user's Dialpad calls (details, transcript, AI recap) into
Macro Calls and its CRM (`crates/dialpad_sync`), and agents use Dialpad's MCP
server. Both need Macro Connect's own Dialpad app: the call scopes below are
approval-only, and dynamically registered clients cannot request them.

## Requirements

- [ ] Register an OAuth app through Dialpad's form (above), giving redirect
      URIs and any special scopes
      (https://developers.dialpad.com/docs/oauth). Dialpad returns a client
      ID and secret.
- [ ] Redirect URIs: `https://connect-dev.macro.com/v1/oauth/callback` and,
      once confirmed, `https://connect.macro.com/v1/oauth/callback`.
- [ ] Scope approval by Dialpad's API team (contact in the OAuth guide) for
      the scopes below.
- [ ] MCP tools: the user's company must be in Dialpad's MCP Early Access
      Program, or every MCP call returns 403
      (https://developers.dialpad.com/docs/dialpad-mcp-server). The REST API
      used by call sync does not need it.
- [ ] Publishing the app in Dialpad's marketplace is optional and not needed
      for users to authorize it (https://developers.dialpad.com/docs/publish-your-app).
- [ ] Conformance needs a Dialpad account with Dialpad Ai enabled (transcripts
      and recaps), ideally a sandbox (`sandbox.dialpad.com`), plus one
      non-admin user: whether a non-admin may subscribe to their own call
      events is unconfirmed (the API reference marks call subscriptions as
      user access; Dialpad's sample app uses an admin key).

## Scopes

- `calls:list`: list the user's past calls for the first-connect import.
- `ai_recap`: read the AI recap (summary, action items) of past calls; live
  calls carry it in their events.
- `offline_access`: a refresh token, so sync keeps working without the user
  signing in again.

Not requested: `recordings_export` (Macro never imports audio),
`message_content_export` (no SMS).

## Probe (2026-11-02)

1. Server: `https://mcp.dialpad.com/mcp`, hosted by Dialpad
   (https://developers.dialpad.com/docs/dialpad-mcp-server).
2. `initialize` → 401, `WWW-Authenticate: Bearer realm="mcp",
   resource_metadata="https://mcp.dialpad.com/.well-known/oauth-protected-resource"`.
3. Protected resource: `resource` = the MCP URL, `authorization_servers` =
   `["https://dialpad.com"]`.
4. `https://dialpad.com/.well-known/oauth-authorization-server`: authorize
   `/oauth2/authorize`, token `/oauth2/token`, `registration_endpoint`
   `/oauth2/register` (DCR), S256 PKCE, `client_secret_basic` /
   `client_secret_post` only (no public clients), `scopes_supported`
   `openid email profile`.
5. Classified `own_app`, not `dcr`: DCR clients cannot be granted the
   approval-only call scopes.
6. Gates: MCP Early Access enrollment (403 otherwise); 24-hour MCP sessions
   for DCR clients; call subscriptions capped at 100 per company.

## Draft

- App name: Macro Connect
- Description: Macro Connect lets Macro users connect their Dialpad account
  to Macro, so their calls, transcripts and AI recaps appear in Macro's Calls
  and CRM, and Macro's agents can use Dialpad's MCP server. (new wording; needs
  approval)
- Data handling, retention, security contact: reuse `answers.md`.

## Log

- 2026-11-02: Probed; drafted this record.
