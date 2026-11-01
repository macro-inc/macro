# Type Alias: MessageCursor

> **MessageCursor** = \{ `created_at`: `string`; `id`: `string`; \}

Cursor for a chronological parent timeline.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at"></a> `created_at` | `string` | Last message creation time or activity occurrence time. |
| <a id="property-id"></a> `id` | `string` | Last entry UUID, used to break timestamp ties across both sources. |
