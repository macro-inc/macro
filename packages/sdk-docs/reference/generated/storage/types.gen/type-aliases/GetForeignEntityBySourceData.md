# Type Alias: GetForeignEntityBySourceData

> **GetForeignEntityBySourceData** = \{ `body?`: `never`; `path`: \{ `foreign_entity_id`: `string`; `source`: `string`; \}; `query?`: `never`; `url`: `"/foreign_entity/by_source/{source}/{foreign_entity_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `foreign_entity_id`: `string`; `source`: `string`; \} | - |
| `path.foreign_entity_id` | `string` | Identifier assigned by the source system; may contain slashes |
| `path.source` | `string` | Foreign entity source, e.g. github_pull_request |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/foreign_entity/by_source/{source}/{foreign_entity_id}"` | - |
