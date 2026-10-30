# Type Alias: UpsertScheduledRequest

> **UpsertScheduledRequest** = \{ `include_signature?`: `boolean` \| `null`; `send_time`: `string`; `source?`: `null` \| [`ScheduledSendSource`](ScheduledSendSource.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-include_signature"></a> `include_signature?` | `boolean` \| `null` | Per-message signature override; absent uses the inbox's send defaults. |
| <a id="property-send_time"></a> `send_time` | `string` | The time to send the message (ISO 8601 format). |
| <a id="property-source"></a> `source?` | `null` \| [`ScheduledSendSource`](ScheduledSendSource.md) | - |
