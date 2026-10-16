# Type Alias: GetEntityPermissionData

> **GetEntityPermissionData** = \{ `body?`: `never`; `path`: \{ `entity_id`: `string`; `entity_type`: `string`; \}; `query?`: `never`; `url`: `"/entity/{entity_type}/{entity_id}/permissions"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: `string`; \} | - |
| `path.entity_id` | `string` | Entity ID |
| `path.entity_type` | `string` | Entity type (document, chat, project, thread, email_thread, channel) |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/entity/{entity_type}/{entity_id}/permissions"` | - |
