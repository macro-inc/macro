---
vendor: discord
apps: [discord]
state: blocked
portal: https://discord.com/developers
account: connect@macro.com
submitted:
last_contact:
next_action: Agent sends the draft question (below) to Discord developer support from connect@macro.com, once browser sign-in is set up, asking whether mcp.discord.com is open to third-party clients and how to get the personal.* scopes
next_action_owner: agent
due: 2026-11-02
---

## Requirements

`mcp.discord.com/mcp` answers with OAuth metadata (authorization server
`https://discord.com`, PKCE S256, `none` token auth allowed) but has no DCR or
CIMD, is not announced, and asks for `personal.*` scopes that Discord's public
OAuth2 docs do not list. Discord's docs say some scopes "require approval from
Discord", and requesting them without approval "may cause errors or
undocumented behavior". Still unconfirmed; stays blocked.

- [ ] **Confirm availability:** ask Discord whether the server is open to
  third-party clients. Channel: Discord developer support,
  <https://support-dev.discord.com/hc/en-us/requests/new> (Developer Help
  Center; returns 403 to curl, open in a browser).
- [ ] **Account type:** Discord account for `connect@macro.com` and an
  application in the Developer Portal. ([portal](https://discord.com/developers))
- [ ] **App fields:** application name, OAuth2 redirects; privacy policy and
  terms URLs on the application's General Information page.
  ([OAuth2 docs](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx))
- [ ] **Scope approval:** `personal.*` scopes undocumented; approval process
  unknown until Discord answers.
- [ ] **Domain verification, demo video, security review, SLA, user caps,
  costs:** unknown until Discord answers.

## Scopes

From the live `WWW-Authenticate` challenge and
`https://mcp.discord.com/.well-known/oauth-protected-resource/mcp`
(2026-10-30). The server asks for all of these together; which are strictly
needed per tool is unknown.

- `identify`: the user's Discord identity for the connection record.
- `guilds`: list the user's servers.
- `guilds.members.read`: the user's member info in a server.
- `connections`: linked third-party accounts. Probably unneeded; ask whether
  the server works without it.
- `personal.guilds.channels.read`, `personal.guilds.channels.messages.read`,
  `personal.guilds.messages.search`: read and search server channels.
- `personal.dm_channels.read`, `personal.dm_channels.messages.read`,
  `personal.dm_channels.messages.search`: read and search DMs.
- `personal.mentions.read`: read mentions.
- `personal.relationships.read`: read the friends list. Probably unneeded.

## Draft

**Question to Discord developer support** (new wording, needs approval; sent
from `connect@macro.com` only):

> Subject: Is mcp.discord.com open to third-party MCP clients?
>
> Hello,
>
> Macro Connect gives products first-party access to their users' tools: it
> connects users to each vendor's own MCP server over the vendor's OAuth,
> through OAuth apps Macro Connect owns and operates. Macro is its first
> customer.
>
> We found Discord's MCP server at `https://mcp.discord.com/mcp`. Its OAuth
> metadata asks for `personal.*` scopes that are not in the public OAuth2
> docs. Could you tell us:
>
> 1. whether the server is available to third-party MCP clients today;
> 2. how an application gets approved for the `personal.*` scopes, and what
>    review that involves;
> 3. whether a client should register its own Discord application, or whether
>    Discord pre-registers MCP clients.
>
> Thank you,
> NEEDS-HUMAN: sender name and title

| Field (if Discord says yes) | Value |
| --- | --- |
| Application name | Macro Connect |
| Description | plan.md first paragraph *(needs approval)* |
| OAuth2 redirect | NEEDS-HUMAN: `connect_api` production host and callback path |
| Privacy policy URL | NEEDS-HUMAN: Macro Connect privacy page |
| Terms of service URL | NEEDS-HUMAN: Macro Connect terms page |
| App icon | NEEDS-HUMAN: Macro Connect icon |

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Re-probed: still no DCR or CIMD, still undocumented `personal.*`
  scopes, no public announcement found. Kept blocked; drafted the question to
  Discord developer support. Nothing sent.
