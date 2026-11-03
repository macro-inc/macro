# Type Alias: AppendCrmFileReferencesData

> **AppendCrmFileReferencesData** = \{ `body`: [`SetEntityPropertyRequest`](SetEntityPropertyRequest.md); `path`: \{ `entity_id`: `string`; `entity_type`: [`PropertyTargetEntityType`](PropertyTargetEntityType.md); `property_id`: `string`; \}; `query?`: `never`; `url`: `"/properties/entities/{entity_type}/{entity_id}/{property_id}/crm-references"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`SetEntityPropertyRequest`](SetEntityPropertyRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: [`PropertyTargetEntityType`](PropertyTargetEntityType.md); `property_id`: `string`; \} | - |
| `path.entity_id` | `string` | Source document ID |
| `path.entity_type` | [`PropertyTargetEntityType`](PropertyTargetEntityType.md) | DOCUMENT |
| `path.property_id` | `string` | Companies or Contacts property ID |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/properties/entities/{entity_type}/{entity_id}/{property_id}/crm-references"` | - |
