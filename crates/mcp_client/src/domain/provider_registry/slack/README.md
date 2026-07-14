# Slack MCP Provider

Slack's MCP server (`https://mcp.slack.com/mcp`) does not support Dynamic Client Registration.
A pre-registered Slack app provides the `client_id` and `client_secret` used by the OAuth flow.

## Slack App

**App dashboard**: https://api.slack.com/apps/A0B3XEX55GB

## Environment Variables

| Variable | Description |
|---|---|
| `SLACK_MCP_CLIENT_ID` | OAuth client ID from the Slack app's Basic Information page |
| `SLACK_MCP_CLIENT_SECRET` | OAuth client secret (server-side only, never log) |

Both must be set together or both omitted. If only one is set the service will panic on startup.

## Manifest

`manifest.json` in this directory defines the Slack app configuration (scopes, redirect URIs).
It can be used with the [Slack Manifest API](https://api.slack.com/reference/manifests) to create
or update the app programmatically.

## Docs
- [MCP Docs](https://docs.slack.dev/ai/slack-mcp-server/)
- [Slack MCP overview](https://docs.slack.dev/agents-and-apps/mcp-for-slack)
- [Slack OAuth v2 user tokens](https://docs.slack.dev/authentication/installing-with-oauth)
- [Slack scopes reference](https://docs.slack.dev/reference/scopes)
- [Slack app manifests](https://docs.slack.dev/reference/manifests)
