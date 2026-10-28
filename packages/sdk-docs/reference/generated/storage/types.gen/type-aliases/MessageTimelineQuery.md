# Type Alias: MessageTimelineQuery

> **MessageTimelineQuery** = \{ `activity_after?`: `string` \| `null`; `activity_before?`: `string` \| `null`; `anchored?`: `boolean` \| `null`; `around?`: `string` \| `null`; `cursor?`: `null` \| [`MessageCursor`](MessageCursor.md); `direction?`: [`MessageDirection`](MessageDirection.md); `ids?`: `string`[]; `include_deleted_threads?`: `boolean`; `limit?`: `number` \| `null`; \}

Root selection shared by channel timelines and document discussions.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-activity_after"></a> `activity_after?` | `string` \| `null` | Include roots or live replies created at or after this time. |
| <a id="property-activity_before"></a> `activity_before?` | `string` \| `null` | Include roots or live replies created before this time. |
| <a id="property-anchored"></a> `anchored?` | `boolean` \| `null` | Select anchored or unanchored roots; absent includes both. |
| <a id="property-around"></a> `around?` | `string` \| `null` | Center on the root containing this message. |
| <a id="property-cursor"></a> `cursor?` | `null` \| [`MessageCursor`](MessageCursor.md) | - |
| <a id="property-direction"></a> `direction?` | [`MessageDirection`](MessageDirection.md) | Which side of the cursor to fetch. |
| <a id="property-ids"></a> `ids?` | `string`[] | Restrict roots to this set, for selected source threads. |
| <a id="property-include_deleted_threads"></a> `include_deleted_threads?` | `boolean` | Include whole-thread tombstones when reconciling persisted document marks. |
| <a id="property-limit"></a> `limit?` | `number` \| `null` | Page size, clamped by the application to 1..=100. |
