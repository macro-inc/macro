# Type Alias: GetAttachmentReferencesData

> **GetAttachmentReferencesData** = \{ `body?`: `never`; `path`: \{ `entity_id`: `string`; `entity_type`: `string`; \}; `query?`: `never`; `url`: `"/channels/attachments/{entity_type}/{entity_id}/references"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: `string`; \} | - |
| `path.entity_id` | `string` | Id of the attachment entity |
| `path.entity_type` | `string` | Type of the attachment entity |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/channels/attachments/{entity_type}/{entity_id}/references"` | - |
