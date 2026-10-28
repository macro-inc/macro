# Type Alias: Table

> **Table** = \{ `database_id`: `string`; `id`: `string`; `name`: `string`; `position`: `string`; `version`: [`TableVersion`](TableVersion.md); \}

One table (tab) of a database.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-database_id"></a> `database_id` | `string` | Owning database. |
| <a id="property-id"></a> `id` | `string` | Identifier. |
| <a id="property-name"></a> `name` | `string` | Display name; also the basis of the table's SQL name. |
| <a id="property-position"></a> `position` | `string` | Fractional index for tab ordering. |
| <a id="property-version"></a> `version` | [`TableVersion`](TableVersion.md) | Current version. |
