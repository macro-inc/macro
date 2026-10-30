---
vendor: figma
apps: [figma]
state: drafting
portal: https://form.asana.com/?k=kBG-ejRQTdY8x_H6a4vM3Q&d=10497086658021
account: connect@macro.com
submitted:
last_contact:
next_action: Human fills the NEEDS-HUMAN items (redirect URI, contact, company facts, logo); the agent then submits Figma's MCP client waitlist form
next_action_owner: human
due: 2026-11-02
---

## Requirements

Figma advertises DCR (`https://api.figma.com/v1/oauth/mcp/register`) but
rejects unknown clients by `client_name` (403); custom OAuth apps cannot
request `mcp:connect`. Only clients in the Figma MCP catalog can connect.

- [ ] **Request channel:** the "join the waitlist" form linked from Figma's
  remote server docs:
  <https://form.asana.com/?k=kBG-ejRQTdY8x_H6a4vM3Q&d=10497086658021>
  (an Asana form; its fields render only in a browser, so they are not listed
  here). ([Remote server installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation))
- [ ] **Second channel:** the catalog page says "apply to register your client
  for remote access, please reach out to your account team". Ask Macro's Figma
  account team, if Macro has one. ([MCP catalog](https://www.figma.com/mcp-catalog/))
- [ ] **Account type:** none stated; a Figma account for `connect@macro.com`
  is needed for conformance once approved.
- [ ] **App fields:** unknown until the form is opened; prepare the Draft
  below, which covers what Vercel's equivalent form asks.
- [ ] **Required pages:** none stated; have landing, privacy, and terms pages
  ready.
- [ ] **Domain verification, demo video, security review:** none stated.
- [ ] **Reviewer SLA:** none published; no public criteria.
- [ ] **User cap before approval:** zero; no Macro Connect user can connect
  until Figma approves.
- [ ] **Costs:** none stated.
- [ ] **Registration after approval:** unknown whether Figma allowlists a DCR
  `client_name` or issues a pre-registered client; ask in the request.

## Scopes

From `https://mcp.figma.com/.well-known/oauth-protected-resource` and
`https://api.figma.com/.well-known/oauth-authorization-server` (2026-10-30):
both advertise only one scope.

- `mcp:connect`: the only scope the Figma MCP server accepts; grants the
  server's tools.

## Draft

| Field | Value |
| --- | --- |
| Contact name | NEEDS-HUMAN: contact person |
| Contact email | connect@macro.com |
| Company name | NEEDS-HUMAN: legal company name |
| Company URL | NEEDS-HUMAN: Macro Connect or Macro URL |
| Client name | Macro Connect |
| Client description | Macro Connect gives products first-party access to their users' tools: it connects users to each vendor's own MCP server over the vendor's OAuth, through OAuth apps Macro Connect owns and operates. Macro is its first customer. *(from plan.md, needs approval)* |
| Expected users | NEEDS-HUMAN: whether to state Macro's current Figma connection count (38) |
| Transport | Streamable HTTP |
| Auth | OAuth 2.1 with PKCE (S256); DCR `client_name` "Macro Connect", or a pre-registered client if Figma prefers |
| Redirect URI(s) | NEEDS-HUMAN: `connect_api` production host and callback path |
| Documentation link | NEEDS-HUMAN: public docs page, if any |
| Logo | NEEDS-HUMAN: logo URL (SVG or high-resolution PNG) |
| Test instructions | NEEDS-HUMAN: Macro test account; then: sign in, open Connections, connect Figma, ask the assistant to describe a frame from a shared file URL |

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Found the request channel (waitlist form linked from Figma's
  remote server docs; catalog page also points to the account team), confirmed
  `mcp:connect` as the only scope from live metadata, drafted offline. Nothing
  submitted.
