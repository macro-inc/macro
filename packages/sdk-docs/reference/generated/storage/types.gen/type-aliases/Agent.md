# Type Alias: Agent

> **Agent** = \{ `auto_accept_permissions?`: `boolean` \| `null`; `bot`: [`Bot`](Bot.md); `channel_ids`: `string`[]; `channel_scope`: [`AgentChannelScope`](AgentChannelScope.md); `default_model`: `string`; `harness`: `string`; `harness_id?`: `null` \| [`HarnessId`](HarnessId.md); `instructions`: `string`; `is_coding`: `boolean`; `mcp`: [`AgentMcpServers`](AgentMcpServers.md); \}

A persisted user- or team-owned AI agent.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-auto_accept_permissions"></a> `auto_accept_permissions?` | `boolean` \| `null` | Whether the agent's sessions approve ACP permission requests without asking. `None` means always prompt. Bypass also requires the harness's opt-in. |
| <a id="property-bot"></a> `bot` | [`Bot`](Bot.md) | The bot identity used for mentions and channel participation. |
| <a id="property-channel_ids"></a> `channel_ids` | `string`[] | Selected channel ids. Empty for a global agent. |
| <a id="property-channel_scope"></a> `channel_scope` | [`AgentChannelScope`](AgentChannelScope.md) | Whether the agent is global or channel-specific. |
| <a id="property-default_model"></a> `default_model` | `string` | Model selected specifically for this agent. |
| <a id="property-harness"></a> `harness` | `string` | Harness used to run the agent. |
| <a id="property-harness_id"></a> `harness_id?` | `null` \| [`HarnessId`](HarnessId.md) | - |
| <a id="property-instructions"></a> `instructions` | `string` | Instructions supplied to the agent at the start of a conversation. |
| <a id="property-is_coding"></a> `is_coding` | `boolean` | Whether the agent works in a repository, which decides how it answers a channel mention: a coding agent posts a magic chip into its live session, a chat agent replies in the thread. Chosen in the agent's settings; the persona's word, not the runtime's. |
| <a id="property-mcp"></a> `mcp` | [`AgentMcpServers`](AgentMcpServers.md) | Which MCP servers sessions of this agent are handed. |
