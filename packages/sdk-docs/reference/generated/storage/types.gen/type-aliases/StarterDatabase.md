# Type Alias: StarterDatabase

> **StarterDatabase** = \{ `created`: `boolean`; `databaseId`: `string` \| `null`; `tableId`: `string` \| `null`; `viewId`: `string` \| `null`; \}

Starter result. A missing database means the user already started or removed it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created"></a> `created` | `boolean` | Whether this request created the example. |
| <a id="property-databaseid"></a> `databaseId` | `string` \| `null` | Accessible starter database, if still present. |
| <a id="property-tableid"></a> `tableId` | `string` \| `null` | Initial table, returned only on first creation. |
| <a id="property-viewid"></a> `viewId` | `string` \| `null` | Initial board view, returned only on first creation. |
