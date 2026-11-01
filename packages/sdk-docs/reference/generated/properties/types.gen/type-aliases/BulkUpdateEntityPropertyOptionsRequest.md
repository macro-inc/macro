# Type Alias: BulkUpdateEntityPropertyOptionsRequest

> **BulkUpdateEntityPropertyOptionsRequest** = \{ `properties`: [`EntityPropertyOptionUpdateRequest`](EntityPropertyOptionUpdateRequest.md)[]; \}

Request to apply option deltas across one or more of an entity's multi-select
properties in a single transaction.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-properties"></a> `properties` | [`EntityPropertyOptionUpdateRequest`](EntityPropertyOptionUpdateRequest.md)[] | The per-property option changes to apply. |
