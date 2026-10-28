# Type Alias: SimpleChannelSearchReponseBaseItemHumanReadableTimestamp

> **SimpleChannelSearchReponseBaseItemHumanReadableTimestamp** = \{ `channel_id`: `string`; `channel_type`: `string`; `created_at`: `string`; `highlight`: [`SearchHighlight`](SearchHighlight.md); `mentions`: `string`[]; `message_id`: `string`; `org_id?`: `number` \| `null`; `sender_id`: `string`; `thread_id?`: `string` \| `null`; `updated_at`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | The channel id |
| <a id="property-channel_type"></a> `channel_type` | `string` | The channel type |
| <a id="property-created_at"></a> `created_at` | `string` | DateTime<Utc> ts_seconds deserialization + RFC3339 serialization |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The highlights on the channel message |
| <a id="property-mentions"></a> `mentions` | `string`[] | The mentions |
| <a id="property-message_id"></a> `message_id` | `string` | The message id |
| <a id="property-org_id"></a> `org_id?` | `number` \| `null` | The org id |
| <a id="property-sender_id"></a> `sender_id` | `string` | The sender id |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | The thread id |
| <a id="property-updated_at"></a> `updated_at` | `string` | DateTime<Utc> ts_seconds deserialization + RFC3339 serialization |
