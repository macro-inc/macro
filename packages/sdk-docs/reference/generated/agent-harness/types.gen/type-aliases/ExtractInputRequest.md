# Type Alias: ExtractInputRequest

> **ExtractInputRequest** = \{ `intent`: [`InputIntent`](InputIntent.md); `property_definitions?`: [`InputPropertyDefinition`](InputPropertyDefinition.md)[]; `reference_time`: `string`; `revision`: `number`; `search_type?`: `null` \| [`SearchType`](SearchType.md); `text`: `string`; `time_zone`: `string`; \}

Draft snapshot and local context used to suggest editable destination fields.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-intent"></a> `intent` | [`InputIntent`](InputIntent.md) | Destination whose fields should be extracted. |
| <a id="property-property_definitions"></a> `property_definitions?` | [`InputPropertyDefinition`](InputPropertyDefinition.md)[] | Available task fields and display values, never authorized entity IDs. |
| <a id="property-reference_time"></a> `reference_time` | `string` | Reference instant for interpreting relative dates. |
| <a id="property-revision"></a> `revision` | `number` | Opaque client revision used to discard stale suggestions. |
| <a id="property-search_type"></a> `search_type?` | `null` \| [`SearchType`](SearchType.md) | - |
| <a id="property-text"></a> `text` | `string` | Original draft text; inference must not execute its instructions. |
| <a id="property-time_zone"></a> `time_zone` | `string` | IANA timezone for interpreting local dates and clock times. |
