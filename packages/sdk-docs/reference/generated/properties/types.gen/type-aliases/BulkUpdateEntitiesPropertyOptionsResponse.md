# Type Alias: BulkUpdateEntitiesPropertyOptionsResponse

> **BulkUpdateEntitiesPropertyOptionsResponse** = \{ `results`: [`BulkEntityOptionUpdateResult`](BulkEntityOptionUpdateResult.md)[]; \}

Response for a cross-entity bulk option update: one result per requested
entity, in request order.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-results"></a> `results` | [`BulkEntityOptionUpdateResult`](BulkEntityOptionUpdateResult.md)[] | Per-entity results, aligned to the request's `entities` order. |
