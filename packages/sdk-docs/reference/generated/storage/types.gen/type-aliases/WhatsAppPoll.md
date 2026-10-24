# Type Alias: WhatsAppPoll

> **WhatsAppPoll** = \{ `options`: [`WhatsAppPollOption`](WhatsAppPollOption.md)[]; `question`: `string`; `selectable_count`: `number`; `voters`: `number`; \}

A poll, read-only in Macro.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-options"></a> `options` | [`WhatsAppPollOption`](WhatsAppPollOption.md)[] | Options in order, with tallies. |
| <a id="property-question"></a> `question` | `string` | The question. |
| <a id="property-selectable_count"></a> `selectable_count` | `number` | How many options one person may choose; 0 means any number. |
| <a id="property-voters"></a> `voters` | `number` | People who voted for anything. |
