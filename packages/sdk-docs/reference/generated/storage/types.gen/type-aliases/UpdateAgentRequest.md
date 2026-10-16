# Type Alias: UpdateAgentRequest

> **UpdateAgentRequest** = \{ `auto_accept_permissions?`: `boolean` \| `null`; `avatar_url?`: `string` \| `null`; `channel_ids?`: `string`[]; `channel_scope`: [`AgentChannelScope`](AgentChannelScope.md); `default_model`: `string`; `description?`: `string` \| `null`; `handle`: `string`; `harness`: `string`; `harness_id?`: `null` \| [`HarnessId`](HarnessId.md); `instructions`: `string`; `is_coding`: `boolean`; `mcp?`: [`AgentMcpServers`](AgentMcpServers.md); `name`: `string`; `team_id?`: `string` \| `null`; \}

Request to replace the editable configuration of a persisted AI agent.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-auto_accept_permissions"></a> `auto_accept_permissions?` | `boolean` \| `null` | Whether the agent's sessions approve ACP permission requests without asking. Omit to always prompt. |
| <a id="property-avatar_url"></a> `avatar_url?` | `string` \| `null` | Optional avatar URL or data URL. |
| <a id="property-channel_ids"></a> `channel_ids?` | `string`[] | Selected channels. Must be non-empty only for `selected` scope. |
| <a id="property-channel_scope"></a> `channel_scope` | [`AgentChannelScope`](AgentChannelScope.md) | Whether the agent is global or channel-specific. |
| <a id="property-default_model"></a> `default_model` | `string` | Model selected specifically for this agent. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Optional description. |
| <a id="property-handle"></a> `handle` | `string` | Stable `@` handle. |
| <a id="property-harness"></a> `harness` | `string` | Harness used to run the agent. |
| <a id="property-harness_id"></a> `harness_id?` | `null` \| [`HarnessId`](HarnessId.md) | - |
| <a id="property-instructions"></a> `instructions` | `string` | Instructions supplied to the agent at the start of a conversation. |
| <a id="property-is_coding"></a> `is_coding` | `boolean` | Whether the agent is a coding agent: a mention is answered with a magic chip into its live session (`true`) or a reply in the thread (`false`). |
| <a id="property-mcp"></a> `mcp?` | [`AgentMcpServers`](AgentMcpServers.md) | Which MCP servers sessions of this agent are handed. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | Team owner. Omit to make the agent private to the caller. |
