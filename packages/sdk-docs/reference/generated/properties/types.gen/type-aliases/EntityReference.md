# Type Alias: EntityReference

> **EntityReference** = \{ `entity_id`: `string`; `entity_type`: [`EntityType`](EntityType.md); `specific_message_id?`: `string` \| `null`; \}

Entity reference for entity-type property values.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-entity_id"></a> `entity_id` | `string` | - |
| <a id="property-entity_type"></a> `entity_type` | [`EntityType`](EntityType.md) | - |
| <a id="property-specific_message_id"></a> `specific_message_id?` | `string` \| `null` | For CHANNEL, CHAT, THREAD entity types - optional specific message ID. This allows referencing a specific message within a thread/channel/chat. |
