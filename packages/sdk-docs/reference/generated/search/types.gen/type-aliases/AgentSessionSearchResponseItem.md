# Type Alias: AgentSessionSearchResponseItem

> **AgentSessionSearchResponseItem** = \{ `agent_session_search_results`: [`AgentSessionSearchResult`](AgentSessionSearchResult.md)[]; `bot_id`: `string`; `created_at`: `string`; `id`: `string`; `name`: `string`; `owner_id`: `string`; `updated_at`: `string`; \}

One accessible agent session, grouped with its matching folded messages.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agent_session_search_results"></a> `agent_session_search_results` | [`AgentSessionSearchResult`](AgentSessionSearchResult.md)[] | Name and folded-message matches. |
| <a id="property-bot_id"></a> `bot_id` | `string` | Agent persona ID. |
| <a id="property-created_at"></a> `created_at` | `string` | Session creation time. |
| <a id="property-id"></a> `id` | `string` | Session ID. |
| <a id="property-name"></a> `name` | `string` | Current persisted name. |
| <a id="property-owner_id"></a> `owner_id` | `string` | Session owner. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Current persisted modification time. |
