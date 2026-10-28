# Type Alias: SimpleCallRecordSearchResponseBaseItemHumanReadableTimestamp

> **SimpleCallRecordSearchResponseBaseItemHumanReadableTimestamp** = \{ `call_id`: `string`; `channel_id?`: `string` \| `null`; `channel_name?`: `string` \| `null`; `duration_ms`: `number`; `ended_at`: `string`; `highlight`: [`SearchHighlight`](SearchHighlight.md); `participant_ids`: `string`[]; `started_at`: `string`; `user_id`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-call_id"></a> `call_id` | `string` | - |
| <a id="property-channel_id"></a> `channel_id?` | `string` \| `null` | - |
| <a id="property-channel_name"></a> `channel_name?` | `string` \| `null` | - |
| <a id="property-duration_ms"></a> `duration_ms` | `number` | - |
| <a id="property-ended_at"></a> `ended_at` | `string` | DateTime<Utc> ts_seconds deserialization + RFC3339 serialization |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | - |
| <a id="property-participant_ids"></a> `participant_ids` | `string`[] | - |
| <a id="property-started_at"></a> `started_at` | `string` | DateTime<Utc> ts_seconds deserialization + RFC3339 serialization |
| <a id="property-user_id"></a> `user_id` | `string` | - |
