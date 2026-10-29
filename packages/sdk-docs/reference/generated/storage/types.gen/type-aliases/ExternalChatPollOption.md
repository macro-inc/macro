# Type Alias: ExternalChatPollOption

> **ExternalChatPollOption** = \{ `mine`: `boolean`; `name`: `string`; `voters`: [`ExternalChatPersonRef`](ExternalChatPersonRef.md)[]; `votes`: `number`; \}

One option of a poll with its votes.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-mine"></a> `mine` | `boolean` | The caller chose it. |
| <a id="property-name"></a> `name` | `string` | Option text. |
| <a id="property-voters"></a> `voters` | [`ExternalChatPersonRef`](ExternalChatPersonRef.md)[] | Who chose it. |
| <a id="property-votes"></a> `votes` | `number` | People who chose it. |
