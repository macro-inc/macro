# Type Alias: ApiChannelWithLatest

> **ApiChannelWithLatest** = \{ `agent_dm?`: `null` \| [`AgentDmProfile`](AgentDmProfile.md); `auto_join_team`: `boolean`; `channel_type`: [`ApiChannelListType`](ApiChannelListType.md); `created_at`: `string`; `frecency_score?`: `number` \| `null`; `id`: `string`; `interacted_at?`: `string` \| `null`; `is_participant`: `boolean`; `latest_message?`: `null` \| [`ApiChannelListMessage`](ApiChannelListMessage.md); `latest_non_thread_message?`: `null` \| [`ApiChannelListMessage`](ApiChannelListMessage.md); `name?`: `string` \| `null`; `org_id?`: `number` \| `null`; `owner_id`: `string`; `participants`: [`ApiChannelListParticipant`](ApiChannelListParticipant.md)[]; `team_id?`: `string` \| `null`; `updated_at`: `string`; `viewed_at?`: `string` \| `null`; \}

Channel list response item.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agent_dm"></a> `agent_dm?` | `null` \| [`AgentDmProfile`](AgentDmProfile.md) | - |
| <a id="property-auto_join_team"></a> `auto_join_team` | `boolean` | Whether team members automatically join the channel. |
| <a id="property-channel_type"></a> `channel_type` | [`ApiChannelListType`](ApiChannelListType.md) | Channel type. |
| <a id="property-created_at"></a> `created_at` | `string` | Channel creation timestamp. |
| <a id="property-frecency_score"></a> `frecency_score?` | `number` \| `null` | Aggregate frecency score. |
| <a id="property-id"></a> `id` | `string` | Channel id. |
| <a id="property-interacted_at"></a> `interacted_at?` | `string` \| `null` | Last interaction timestamp for requesting user. |
| <a id="property-is_participant"></a> `is_participant` | `boolean` | Whether the requesting user is an active participant of the channel. |
| <a id="property-latest_message"></a> `latest_message?` | `null` \| [`ApiChannelListMessage`](ApiChannelListMessage.md) | - |
| <a id="property-latest_non_thread_message"></a> `latest_non_thread_message?` | `null` \| [`ApiChannelListMessage`](ApiChannelListMessage.md) | - |
| <a id="property-name"></a> `name?` | `string` \| `null` | Channel name. |
| <a id="property-org_id"></a> `org_id?` | `number` \| `null` | Organization id. |
| <a id="property-owner_id"></a> `owner_id` | `string` | Channel owner user id. |
| <a id="property-participants"></a> `participants` | [`ApiChannelListParticipant`](ApiChannelListParticipant.md)[] | Active participants. |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | Team id. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Channel last-updated timestamp. |
| <a id="property-viewed_at"></a> `viewed_at?` | `string` \| `null` | Last viewed timestamp for requesting user. |
