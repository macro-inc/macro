# Type Alias: ExternalChatCall

> **ExternalChatCall** = \{ `durationSeconds?`: `number` \| `null`; `outcome`: [`ExternalChatCallOutcome`](ExternalChatCallOutcome.md); `video`: `boolean`; \}

A call in the group.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-durationseconds"></a> `durationSeconds?` | `number` \| `null` | Length, when it connected. |
| <a id="property-outcome"></a> `outcome` | [`ExternalChatCallOutcome`](ExternalChatCallOutcome.md) | How it went for the account that saw it. |
| <a id="property-video"></a> `video` | `boolean` | Video rather than voice. |
