# Type Alias: CallFilters

> **CallFilters** = \{ `attended?`: `boolean` \| `null`; `call_ids?`: `string`[]; `channel_ids?`: `string`[]; `speaker_ids?`: `string`[]; `status?`: `null` \| [`CallStatus`](CallStatus.md); \}

Filters for call records.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attended"></a> `attended?` | `boolean` \| `null` | Legacy filter by whether the requesting user attended the call. Prefer [`CallFilters::status`] for new callers. `None` = no filter, `Some(true)` = only calls the user joined, `Some(false)` = only calls the user did not join. |
| <a id="property-call_ids"></a> `call_ids?` | `string`[] | Call record IDs to filter by. Empty to include all calls. |
| <a id="property-channel_ids"></a> `channel_ids?` | `string`[] | Channel IDs to filter calls by. Empty to include all calls. |
| <a id="property-speaker_ids"></a> `speaker_ids?` | `string`[] | Speaker macro user ids. Empty to include all. |
| <a id="property-status"></a> `status?` | `null` \| [`CallStatus`](CallStatus.md) | - |
