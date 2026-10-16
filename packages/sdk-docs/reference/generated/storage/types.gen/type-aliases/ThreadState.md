# Type Alias: ThreadState

> **ThreadState** = \{ `anchor?`: `null` \| [`ThreadAnchor`](ThreadAnchor.md); `created_at`: `string`; `deleted_at?`: `string` \| `null`; `resolved`: `boolean`; `root_id`: `string`; `updated_at`: `string`; `user_id`: `string`; \}

State belonging to a whole thread, keyed by its root message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-anchor"></a> `anchor?` | `null` \| [`ThreadAnchor`](ThreadAnchor.md) | - |
| <a id="property-created_at"></a> `created_at` | `string` | Creation time of the discussion. |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | Explicit deletion of the entire thread, distinct from root deletion. |
| <a id="property-resolved"></a> `resolved` | `boolean` | Whether this discussion has been resolved. |
| <a id="property-root_id"></a> `root_id` | `string` | Root message UUID; there is no separate thread identity. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Last state change. |
| <a id="property-user_id"></a> `user_id` | `string` | User who owns this discussion, including imported discussions. |
