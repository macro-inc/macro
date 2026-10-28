# Type Alias: HarnessSession

> **HarnessSession** = \{ `bot_handle`: `string`; `bot_id`: [`BotId`](BotId.md); `bot_name`: `string`; `created_at`: `string`; `model`: `string`; `modified_at`: `string`; `name`: `string`; `owner_id`: `string`; `session_id`: `string`; `status`: `string`; \}

An agent session running on a harness, as listed for the daemon's UI.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bot_handle"></a> `bot_handle` | `string` | The agent's `@` handle. |
| <a id="property-bot_id"></a> `bot_id` | [`BotId`](BotId.md) | The agent the session runs for. |
| <a id="property-bot_name"></a> `bot_name` | `string` | The agent's display name. |
| <a id="property-created_at"></a> `created_at` | `string` | Creation timestamp. |
| <a id="property-model"></a> `model` | `string` | Model the session was opened with. |
| <a id="property-modified_at"></a> `modified_at` | `string` | Last-activity timestamp. |
| <a id="property-name"></a> `name` | `string` | The session's display name. |
| <a id="property-owner_id"></a> `owner_id` | `string` | The user the session belongs to. |
| <a id="property-session_id"></a> `session_id` | `string` | The session id. |
| <a id="property-status"></a> `status` | `string` | Session lifecycle status, e.g. `no_messages`, `active`. |
