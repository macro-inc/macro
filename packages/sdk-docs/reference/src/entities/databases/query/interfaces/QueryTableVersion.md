# Interface: QueryTableVersion

A version observed on a typed table handle, reusable as a write guard.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-table"></a> `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) | Table whose version was observed. |
| <a id="property-version"></a> `version` | `number` | Opaque version to pass back as an optimistic write guard. |
