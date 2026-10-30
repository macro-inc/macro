---
vendor: zoom
apps: [zoom, zoom_admin]
state: drafting
portal: https://marketplace.zoom.us
account: connect@macro.com
submitted:
last_contact:
next_action: Human fills the NEEDS-HUMAN items in the Draft (redirect host, company facts, legal and support URLs, security evidence); the agent then creates the General app
next_action_owner: human
due: 2026-11-02
---

## Requirements

Zoom MCP has no DCR or CIMD (Zoom's docs say so; probe confirms); PKCE (S256)
required; token endpoint auth is `client_secret_basic`.

- [ ] **Account:** a Zoom account with developer or admin role, signed in to the
  Marketplace as `connect@macro.com`.
  ([MCP servers overview](https://developers.zoom.us/docs/mcp/servers.md))
- [ ] **App type:** Marketplace **General app** (Develop > Build app > General
  app); manual client registration only.
  ([Connect to Zoom MCP servers](https://developers.zoom.us/docs/mcp/servers/connect-to-zoom-mcp-servers.md))
- [ ] **App fields:** Basic information (app name, credentials), OAuth
  Information (redirect URL, OAuth allow list), Scopes, listing (short and long
  description, categories, branding).
  ([Connect to Zoom MCP servers](https://developers.zoom.us/docs/mcp/servers/connect-to-zoom-mcp-servers.md),
  [branding guidelines](https://developers.zoom.us/docs/distribute/app-review-guidelines/#intellectual-property))
- [ ] **OAuth allow list rules:** HTTPS, fully-qualified domain, no localhost,
  no ngrok or default Heroku domains.
  ([Security requirements](https://developers.zoom.us/docs/distribute/security-requirements.md))
- [ ] **Required pages:** Privacy Policy URL, Terms of Use URL, Home URL,
  Support URL, self-serve documentation URL.
  ([Submit for review](https://developers.zoom.us/docs/distribute/app-submission/submit-apps-review.md),
  [listing links](https://developers.zoom.us/docs/build-flow/app-listing/links/))
- [ ] **Domain verification:** every unique domain among the privacy, terms,
  redirect, and home URLs, once each, by DNS TXT, HTML file, `<meta>` tag, or
  manual approval from Zoom support.
  ([Submit for review](https://developers.zoom.us/docs/distribute/app-submission/submit-apps-review.md))
- [ ] **Technical Design section:** architecture, security controls, and how
  data from each scope is used; "Yes" answers need supporting evidence
  (screenshots, PDFs, diagrams).
  ([Security requirements](https://developers.zoom.us/docs/distribute/security-requirements.md#technical-design))
- [ ] **Security review:** Marketplace Security tests against the OWASP Top 10
  (least privilege, web scanning, manual testing, vulnerable libraries).
  ([App review process](https://developers.zoom.us/docs/distribute/app-review-process.md))
- [ ] **Reviewer test plan and test credentials** for a test account (one per
  role); first submission uses the Production Client ID.
  ([Submit for review](https://developers.zoom.us/docs/distribute/app-submission/submit-apps-review.md))
- [ ] **Demo video:** not listed as required in the current docs; re-check the
  build flow's required-fields list when the app exists.
- [ ] **Marketplace developer agreement:** accept (human gate).
  ([Submit for review](https://developers.zoom.us/docs/distribute/app-submission/submit-apps-review.md))
- [ ] **Reviewer SLA:** none published; two phases (Operations, then Security);
  poorly described scopes or listings lengthen it.
  ([App review process](https://developers.zoom.us/docs/distribute/app-review-process.md))
- [ ] **User cap before approval:** unpublished (private) apps install only in
  Macro Connect's own Zoom account; a beta authorization URL needs Zoom's
  approval, is for testing, lasts 4 weeks (two 4-week extensions), "limited
  number of users". Real users need a published app; publishing can still be
  limited to specific users or domains.
  ([Sharing private and beta apps](https://developers.zoom.us/docs/distribute/sharing-private-and-beta-apps.md),
  [App distribution](https://developers.zoom.us/docs/distribute.md))
- [ ] **Beta URL route (optional, not recommended):** an approved shareable
  authorization URL needs SSDLC docs, SAST and DAST output, privacy policy, and
  three of: pen-test summary, security policy, incident response policy,
  vulnerability management, infra/dependency management.
  ([Security requirements](https://developers.zoom.us/docs/distribute/security-requirements.md))
- [ ] **Costs:** no Marketplace fee found. MCP rate limits are per Zoom account
  and plan, shared with Zoom's APIs.
  ([MCP servers overview](https://developers.zoom.us/docs/mcp/servers.md))
- [ ] **Regional gateways:** `mcp.zoom.us` plus AU, CA, EU, IN, SA, SG, US
  hosts; confirm one app serves all regions.
  ([Zoom MCP](https://developers.zoom.us/docs/mcp.md))

## Scopes

From the live protected-resource metadata (2026-10-30):
`https://zoom.us/.well-known/oauth-protected-resource/mcp/zoom/streamable` and
`https://mcp.zoom.us/.well-known/oauth-protected-resource/mcp/admin/streamable`;
authorization server `https://zoom.us`. Zoom's per-tool scope pages were not
reachable; check the in-portal scope descriptions against the server's tool
list at conformance.

Zoom puts user-level and admin-level scopes in separate management types, so
`zoom_admin` likely needs its own admin-managed app (unverified; check the
portal when creating the app). Request 1 goes first; request 2 (`zoom_admin`)
is filed separately so admin scopes don't slow request 1's review.

**Request 1, `zoom` (user-managed app), read:**

- `meeting:read:search`: search the user's meetings.
- `meeting:read:assets`: read a meeting's summary, transcript, and assets.
- `cloud_recording:read:list_user_recordings`: list the user's cloud recordings.
- `cloud_recording:read:content`: read recording transcripts and content.
- `my_notes:read:content`: read the user's Zoom notes.
- `docs:read:export`: read Zoom Docs content.
- `docs:read:list_file_collaborators`: list who a doc is shared with.
- `hub:read:content`: read Zoom Hub content.
- `agentic_search:read:search`: Zoom's cross-product search tool.
- `agentic_search:read:ask`: Zoom's question-answering tool over the user's data.
- `workflow:read:definition`, `workflow:read:list_definitions`: read workflows.

**Request 1, `zoom`, write** (the server exposes these tools; drop any Macro
does not use before filing):

- `meeting:write:meeting`, `meeting:update:meeting`, `meeting:delete:meeting`:
  schedule, edit, and cancel the user's meetings.
- `meeting:update:in_meeting_controls`: in-meeting controls tool.
- `docs:write:import`: create docs from imported content.
- `docs:write:collaborator`, `docs:update:collaborator`,
  `docs:delete:collaborator`: share and unshare docs.
- `hub:write:content`: write Hub content.
- `workflow:write:definition`: create or edit workflows.

**Request 2, `zoom_admin` (admin-managed app):**

- `user:read:user:admin`, `user:read:list_users:admin`: read account users.
- `user:read:settings:admin`, `user:read:list_permissions:admin`: read user
  settings and roles.
- `group:read:list_groups:admin`, `group:read:list_members:admin`,
  `group:read:settings:admin`: read groups.
- `account:read:settings:admin`: read account settings.
- Not requested: `account:read:settings:master`, `account:update:settings:master`,
  `account:read:lock_settings:master` (master-account/sub-account scopes; Macro's
  users are not Zoom master accounts).

## Draft

New wording below needs the human's approval before it goes into
`answers.md`; `answers.md` is empty today.

| Field | Value |
| --- | --- |
| App type | General app |
| Management type | User-managed (`zoom`); admin-managed (`zoom_admin`, separate app) |
| App name | Macro Connect |
| Short description | Connect your Zoom account to AI tools through Zoom's own MCP server. *(new wording, needs approval)* |
| Long description | Macro Connect gives products first-party access to their users' tools: it connects users to each vendor's own MCP server over the vendor's OAuth, through OAuth apps Macro Connect owns and operates. Macro is its first customer. *(from plan.md, needs approval)* |
| Category | NEEDS-HUMAN: pick Marketplace category (suggest Productivity) |
| Developer contact name | NEEDS-HUMAN: contact person |
| Developer contact email | connect@macro.com |
| Company name | NEEDS-HUMAN: legal company name |
| Home URL | NEEDS-HUMAN: Macro Connect landing page URL |
| OAuth redirect URL | NEEDS-HUMAN: `connect_api` production host and callback path |
| OAuth allow list | NEEDS-HUMAN: same host as the redirect URL |
| Privacy Policy URL | NEEDS-HUMAN: Macro Connect privacy page |
| Terms of Use URL | NEEDS-HUMAN: Macro Connect terms page |
| Support URL | NEEDS-HUMAN: support page or address |
| Documentation URL | NEEDS-HUMAN: self-serve docs page for the Zoom connection |
| Domain verification | NEEDS-HUMAN: DNS TXT access for the Connect domain |
| Scopes | Request 1 list above |
| Technical design: architecture | Users connect from a customer product (Macro) through Macro Connect's hosted connect flow. Macro Connect runs the OAuth authorization-code flow with PKCE against `zoom.us`, stores the grant encrypted with AWS KMS and bound to the connection, refreshes it, and proxies MCP requests to `mcp.zoom.us` with the user's token. It calls no Zoom REST APIs directly. *(new wording, needs approval)* |
| Technical design: data use per scope | Zoom data passes through to the user's AI client in the MCP response; Macro Connect stores only the OAuth grant and connection metadata. NEEDS-HUMAN: confirm no MCP response content is stored or logged, and the retention period for connection records |
| Technical design: data deletion on uninstall | NEEDS-HUMAN: deauthorization handling and deletion wording |
| Technical design: security evidence | NEEDS-HUMAN: which of SSDLC, SAST, DAST, pen test, security policy, incident response policy exist |
| Release notes for reviewer (test plan) | 1. Sign in to the test Macro account. 2. Open Connections, choose Zoom, sign in with the provided Zoom test user, approve the scopes. 3. Ask the assistant to list recent meetings and summarize one. 4. Disconnect Zoom in Macro, then confirm the app is gone from the Zoom account's Added Apps. *(draft; confirm against the built flow)* |
| Test credentials | NEEDS-HUMAN: Macro test account and Zoom test user with sample meetings |
| Activation | Activate after approval (Zoom activates) |
| Developer agreement | NEEDS-HUMAN: accept the Marketplace developer agreement |

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Requirements, scopes, and offline draft filled from Zoom's
  current docs and live OAuth metadata (both servers: no
  `registration_endpoint`, no CIMD, PKCE S256). Nothing submitted.
