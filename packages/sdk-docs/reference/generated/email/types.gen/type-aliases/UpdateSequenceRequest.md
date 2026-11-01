# Type Alias: UpdateSequenceRequest

> **UpdateSequenceRequest** = \{ `footer?`: `string` \| `null`; `linkId?`: `string` \| `null`; `name?`: `string` \| `null`; `status?`: `null` \| [`SequenceStatus`](SequenceStatus.md); `steps?`: [`Step`](Step.md)[] \| `null`; `version`: `number`; \}

Changes to a sequence; `None` leaves a field as it is.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-footer"></a> `footer?` | `string` \| `null` | New footer. |
| <a id="property-linkid"></a> `linkId?` | `string` \| `null` | New sending inbox. |
| <a id="property-name"></a> `name?` | `string` \| `null` | New name. |
| <a id="property-status"></a> `status?` | `null` \| [`SequenceStatus`](SequenceStatus.md) | - |
| <a id="property-steps"></a> `steps?` | [`Step`](Step.md)[] \| `null` | New steps. |
| <a id="property-version"></a> `version` | `number` | The version the caller last read. |
