# Type Alias: ForeignEntityFilters

> **ForeignEntityFilters** = \{ `foreign_entity_ids?`: `string`[]; `foreign_entity_sources?`: `string`[]; `ids?`: `string`[]; `includes_me?`: `boolean`; `notification_filters?`: [`NotificationFilters`](NotificationFilters.md); \}

Filters for foreign entity records.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-foreign_entity_ids"></a> `foreign_entity_ids?` | `string`[] | External entity identifiers to filter by. Empty to include all external IDs. |
| <a id="property-foreign_entity_sources"></a> `foreign_entity_sources?` | `string`[] | External source names to filter by. Empty to include all sources. |
| <a id="property-ids"></a> `ids?` | `string`[] | Internal foreign entity record IDs to filter by. Empty to include all records. |
| <a id="property-includes_me"></a> `includes_me?` | `boolean` | When true, only return foreign entities whose metadata lists the requesting user as a participant (GitHub `involves:me` semantics for `github_pull_request` records). False or absent applies no filter. Serialized in filter ASTs as the `"me"` literal. |
| <a id="property-notification_filters"></a> `notification_filters?` | [`NotificationFilters`](NotificationFilters.md) | Filter by the notification state of the foreign entity (e.g. whether the requesting user's GitHub PR notification is done/seen). |
