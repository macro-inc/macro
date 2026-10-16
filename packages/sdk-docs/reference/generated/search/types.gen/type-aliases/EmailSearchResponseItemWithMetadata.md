# Type Alias: EmailSearchResponseItemWithMetadata

> **EmailSearchResponseItemWithMetadata** = [`EmailSearchResponseItem`](EmailSearchResponseItem.md) & \{ `created_at`: `string`; `inbox_visible`: `boolean`; `is_draft`: `boolean`; `is_important`: `boolean`; `is_read`: `boolean`; `properties?`: [`SoupProperty`](SoupProperty.md)[] \| `null`; `snippet?`: `string` \| `null`; `updated_at`: `string`; `viewed_at?`: `string` \| `null`; \}

EmailSearchResponseItem object with email metadata we fetch from email service. we don't store these
timestamps in opensearch as they would require us to update each email message record for the thread
every time the thread updates (specifically for updated_at and viewed_at)

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `created_at` | `string` | - |
| `inbox_visible` | `boolean` | - |
| `is_draft` | `boolean` | - |
| `is_important` | `boolean` | - |
| `is_read` | `boolean` | - |
| `properties?` | [`SoupProperty`](SoupProperty.md)[] \| `null` | Entity properties (e.g. tags) on the thread. |
| `snippet?` | `string` \| `null` | - |
| `updated_at` | `string` | - |
| `viewed_at?` | `string` \| `null` | - |
