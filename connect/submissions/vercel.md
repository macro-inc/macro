---
vendor: vercel
apps: [vercel_token_auth]
state: drafting
portal: https://forms.gle/FQ3nYPbovoHvbfmz9
account: connect@macro.com
submitted:
last_contact:
next_action: Human fills the NEEDS-HUMAN items (redirect URI, contact, company facts, logo and wordmark URLs); the agent then submits Vercel's client review form
next_action_owner: human
due: 2026-11-02
---

## Requirements

Vercel advertises CIMD and DCR (and `none` token auth), but "Vercel MCP only
supports AI clients that have been reviewed and approved by Vercel"; the
redirect URI must be allowlisted by Vercel's auth server.

- [ ] **Request channel:** the client review form
  <https://forms.gle/FQ3nYPbovoHvbfmz9> (Google Form "MCP Client Directory"),
  linked from [Vercel MCP docs](https://vercel.com/docs/agent-resources/vercel-mcp).
- [ ] **Listing is public:** approved clients appear on Vercel's Supported
  Clients page with the submitted name, description, logo, and wordmark.
  ([form](https://forms.gle/FQ3nYPbovoHvbfmz9))
- [ ] **Account type:** none stated; a Vercel account for `connect@macro.com`
  for conformance.
- [ ] **App fields:** 12 required fields plus optional comments; all in the
  Draft below.
- [ ] **Protocol:** must support the 2025-06-18 MCP auth spec and Streamable
  HTTP. ([form](https://forms.gle/FQ3nYPbovoHvbfmz9))
- [ ] **Required pages:** company URL and client documentation links.
- [ ] **Domain verification, demo video, security review:** none stated;
  Vercel says it approves clients that "meet our standards for authorization,
  data handling, and protocol adherence".
  ([launch post](https://vercel.com/blog/introducing-vercel-mcp-connect-vercel-to-your-ai-tools))
- [ ] **Reviewer SLA:** none published. A community thread shows Vercel Support
  routing client requests to the forum
  ([thread](https://community.vercel.com/t/request-approve-harness-development-for-vercel-mcp-oauth/49282)).
- [ ] **User cap before approval:** zero over OAuth; the current fallback is a
  pasted Vercel access token.
- [ ] **Costs:** none; Vercel MCP is on all plans, under Vercel's AI Product
  Terms. ([docs](https://vercel.com/docs/agent-resources/vercel-mcp))

## Scopes

From `https://mcp.vercel.com/.well-known/oauth-protected-resource` and
`https://vercel.com/.well-known/oauth-authorization-server` (2026-10-30). The
resource advertises only `openid`; access is governed by the user's Vercel team
permissions, not scopes.

- `openid`: the only scope the MCP resource lists.
- `offline_access`: refresh tokens, so connections survive access-token expiry.
- Not requested: `email`, `profile` (not needed), `ema_issuer:manage`
  (unrelated to MCP).

## Draft

Fields of the form as fetched 2026-10-30, in order. Field types: text unless
noted.

| Field | Required | Value |
| --- | --- | --- |
| Primary Contact Name | yes | NEEDS-HUMAN: contact person |
| Primary Contact Email | yes | connect@macro.com |
| Company/Organization Name | yes | NEEDS-HUMAN: legal company name |
| Company/Organization URL | yes | NEEDS-HUMAN: Macro Connect or Macro URL |
| MCP Client Name | yes | Macro Connect |
| MCP Client Description | yes | Macro Connect gives products first-party access to their users' tools: it connects users to each vendor's own MCP server over the vendor's OAuth, through OAuth apps Macro Connect owns and operates. Macro is its first customer. *(from plan.md, needs approval)* |
| MCP Client Documentation Link(s) | yes | NEEDS-HUMAN: public docs page |
| Transport Support (checkboxes: Streamable HTTP, SSE) | yes | Streamable HTTP |
| MCP Client OAuth Redirect URI(s) | yes | NEEDS-HUMAN: `connect_api` production host and callback path |
| Server Logo (link to SVG/PNG; consents to display) | yes | NEEDS-HUMAN: logo URL and consent to Vercel displaying it |
| Wordmark (link to SVG/PNG; consents to display) | yes | NEEDS-HUMAN: wordmark URL and consent |
| Client test setup instructions (paragraph) | yes | 1. Sign in to the provided Macro test account. 2. Open Connections, choose Vercel, sign in to Vercel and approve. 3. Ask the assistant to list your Vercel projects and the latest deployment of one. Macro Connect registers with a Client ID Metadata Document (or DCR if Vercel prefers) and uses PKCE. NEEDS-HUMAN: test account credentials. *(draft)* |
| Additional comments (paragraph) | no | Ask which registration method approved clients should use (CIMD, DCR, or pre-registered) and whether the allowlist keys on redirect URI, `client_id` URL, or both. *(draft)* |

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Found the request channel (Google Form linked from Vercel MCP
  docs), read its 13 fields without submitting, checked live metadata (CIMD
  true, DCR, `none` auth), drafted offline. Nothing submitted.
