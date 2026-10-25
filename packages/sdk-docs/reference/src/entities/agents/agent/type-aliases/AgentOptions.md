# Type Alias: AgentOptions

> **AgentOptions** = `Omit`\<[`CreateAgentRequest`](../../../../../generated/storage/types.gen/type-aliases/CreateAgentRequest.md), `"channel_ids"` \| `"team_id"` \| `"harness_id"` \| `"auto_accept_permissions"` \| `"avatar_url"` \| `"channel_scope"` \| `"default_model"` \| `"is_coding"`\> & \{ `autoAcceptPermissions?`: `boolean`; `avatarUrl?`: `string`; `channels?`: [`Channel`](../../../channels/channel/classes/Channel.md)[]; `channelScope`: [`CreateAgentRequest`](../../../../../generated/storage/types.gen/type-aliases/CreateAgentRequest.md)\[`"channel_scope"`\]; `defaultModel`: `string`; `host?`: [`Harness`](../../../harnesses/harness/classes/Harness.md); `isCoding`: `boolean`; `team?`: [`Team`](../../../teams/team/classes/Team.md); \}

Agent creation and replacement settings.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `autoAcceptPermissions?` | `boolean` | Whether tool permissions are automatically accepted. |
| `avatarUrl?` | `string` | Avatar URL. |
| `channels?` | [`Channel`](../../../channels/channel/classes/Channel.md)[] | Channels the agent can access. |
| `channelScope` | [`CreateAgentRequest`](../../../../../generated/storage/types.gen/type-aliases/CreateAgentRequest.md)\[`"channel_scope"`\] | Channel visibility policy. |
| `defaultModel` | `string` | Default model. |
| `host?` | [`Harness`](../../../harnesses/harness/classes/Harness.md) | Host running the agent. |
| `isCoding` | `boolean` | Whether this is a coding agent. |
| `team?` | [`Team`](../../../teams/team/classes/Team.md) | Owning team. |
