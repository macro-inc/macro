# Type Alias: DatabaseQueryRequest

> **DatabaseQueryRequest** = \{ `baseVersions?`: \{\[`key`: `string`\]: `number`; \}; `databaseId?`: `null` \| [`DatabaseId`](DatabaseId.md); `sql`: `string`; \}

One SQL statement with an optional default database and optimistic write guards.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-baseversions"></a> `baseVersions?` | \{\[`key`: `string`\]: `number`; \} | Expected version for each table a subsequent statement writes. |
| <a id="property-databaseid"></a> `databaseId?` | `null` \| [`DatabaseId`](DatabaseId.md) | - |
| <a id="property-sql"></a> `sql` | `string` | One supported SQL statement. Writes execute once, without automatic retries. |
