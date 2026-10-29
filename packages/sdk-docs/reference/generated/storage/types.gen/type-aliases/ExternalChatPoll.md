# Type Alias: ExternalChatPoll

> **ExternalChatPoll** = \{ `options`: [`ExternalChatPollOption`](ExternalChatPollOption.md)[]; `question`: `string`; `selectableCount`: `number`; `voters`: `number`; \}

A poll, read-only in Macro.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-options"></a> `options` | [`ExternalChatPollOption`](ExternalChatPollOption.md)[] | Options in order, with tallies. |
| <a id="property-question"></a> `question` | `string` | The question. |
| <a id="property-selectablecount"></a> `selectableCount` | `number` | How many options one person may choose; 0 means any number. |
| <a id="property-voters"></a> `voters` | `number` | People who voted for anything. |
