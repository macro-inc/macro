---
vendor: box
apps: [box]
state: drafting
portal: https://developer.box.com/guides/box-mcp/remote/
account: connect@macro.com
submitted:
last_contact:
next_action: Human approves emailing integrate@box.com from connect@macro.com to ask how an MCP client becomes a predefined Box MCP integration (draft below)
next_action_owner: human
due: 2026-11-02
---

## Requirements

`mcp.box.com` has no DCR or CIMD (probed; authorization server
`https://api.box.com`, PKCE S256, confidential client). Box documents two ways
for a client to reach it, both enabled by each customer's Box admin:

1. **Predefined Box MCP server:** the admin finds the client under Admin
   Console > Integrations (category MCP) and enables it. One client for every
   Box enterprise; requires Box to list Macro Connect.
2. **Unlisted custom Box MCP server:** each enterprise's admin configures the
   "Box MCP server" integration, adds integration credentials, enters the
   client's redirect URI and scopes, and hands the client ID and secret to the
   client. That is one OAuth client per customer enterprise: Macro Connect
   would need bring-your-own-client per Box tenant. Not viable for v1's 3
   connections across unknown enterprises.

([Box remote MCP](https://developer.box.com/guides/box-mcp/remote/),
[Managing Box MCP servers](https://support.box.com/hc/en-us/articles/43847256139923-Managing-Box-MCP-Servers))

Route 1 checklist:

- [ ] **Request channel:** no published self-serve form for predefined MCP
  listings. Box staff on the community forum: build an OAuth 2.0 app in the
  Developer Console, publish it in the Integrations center, approval by Box
  Business Development and Partner Product Management, via a partner
  representative or an integration request.
  ([forum answer](https://community.box.com/ai-developers-23/clarification-on-box-mcp-integration-setup-35080));
  Integrations review contact: `integrate@box.com`
  ([Integrations guide](https://developer.box.com/guides/applications/integrations)).
- [ ] **Account type:** Box developer account and a Platform app with
  OAuth 2.0 (user authentication) in the Developer Console.
  ([Integrations guide](https://developer.box.com/guides/applications/integrations))
- [ ] **App fields (Integrations listing):** categories, short description, long
  description, Add-button URL, screenshots, app icon, supplementary support
  information, checklist confirmation.
  ([Integrations guide](https://developer.box.com/guides/applications/integrations))
- [ ] **Required pages:** the Add-button URL and support information; have
  landing, privacy, and terms pages ready.
- [ ] **Domain verification, demo video, security review:** none published.
- [ ] **Reviewer SLA:** "as soon as possible"; none published.
- [ ] **User cap before approval:** zero for other enterprises; each user's Box
  admin must also enable the integration after listing.
- [ ] **Costs:** none published. `docgen.readwrite` needs the customer's Box
  Enterprise Advanced licence.
  ([Box remote MCP](https://developer.box.com/guides/box-mcp/remote/))
- [ ] **Open question:** whether a Developer Console OAuth app's tokens are
  accepted by `mcp.box.com` at all, or only Admin Console MCP credentials. Ask
  in the email below.

## Scopes

Live metadata advertises no scopes; Box's docs list three for MCP clients.

- `root_readwrite`: read, search, and write files and folders the user can
  already access (Box MCP tools include uploads and folder changes).
- `ai.readwrite`: Box AI tools (ask, extract) over the user's files.
- Not requested: `docgen.readwrite` (Doc Gen; needs Enterprise Advanced).

If Macro is read-only for Box, ask whether the server accepts `root_readonly`
instead of `root_readwrite`.

## Draft

**Email to `integrate@box.com`** (new wording, needs approval; sent from
`connect@macro.com` only):

> Subject: Listing Macro Connect as a predefined Box MCP integration
>
> Hello Box Partner team,
>
> Macro Connect gives products first-party access to their users' tools: it
> connects users to each vendor's own MCP server over the vendor's OAuth,
> through OAuth apps Macro Connect owns and operates. Macro is its first
> customer, and its users already connect Box today.
>
> We would like Macro Connect to appear as a predefined client under Admin
> Console > Integrations > MCP, so a Box admin can enable it without creating
> credentials by hand. Could you tell us:
>
> 1. the process to become a predefined Box MCP integration, and whether it
>    needs a Box partnership;
> 2. whether a Platform app (OAuth 2.0) from the Developer Console is the right
>    starting point, and whether its tokens are accepted by `mcp.box.com`;
> 3. which scopes to request (we plan `root_readwrite` and `ai.readwrite`).
>
> Thank you,
> NEEDS-HUMAN: sender name and title

**Integrations listing (for after Box confirms the path):**

| Field | Value |
| --- | --- |
| App name | Macro Connect |
| Categories | NEEDS-HUMAN: pick (suggest AI, Productivity) |
| Short description | Connect your Box account to AI tools through Box's own MCP server. *(new wording, needs approval)* |
| Long description | plan.md first paragraph, as in the email *(needs approval)* |
| Add-button URL | NEEDS-HUMAN: Macro Connect landing or connect URL |
| Redirect URI | NEEDS-HUMAN: `connect_api` production host and callback path |
| Screenshots | NEEDS-HUMAN: capture once the connect flow is built |
| App icon | NEEDS-HUMAN: Macro Connect icon |
| Support information | NEEDS-HUMAN: support URL or address |
| Scopes | `root_readwrite`, `ai.readwrite` |

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Requirements filled. An unlisted (custom) integration is not
  enough for v1: it gives one client per customer enterprise, created by that
  enterprise's admin. The path is a predefined listing through Box's partner
  team; email to `integrate@box.com` drafted. Nothing sent.
