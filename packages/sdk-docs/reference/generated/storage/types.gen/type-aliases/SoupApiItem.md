# Type Alias: SoupApiItem

> **SoupApiItem** = [`SoupItem`](SoupItem.md) & \{ `frecency_score`: `number`; `is_favorited`: `boolean`; `notified_at?`: `string` \| `null`; `touched_at?`: `string` \| `null`; \}

API representation of a soup item with its per-viewer enrichments.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `frecency_score` | `number` | - |
| `is_favorited` | `boolean` | Whether the requesting user has favorited this entity. |
| `notified_at?` | `string` \| `null` | When the caller was last notified about this entity, present only when the page was ordered by `notified_at`. Clients keep the notified feed ordered and date-bucketed on this value. |
| `touched_at?` | `string` \| `null` | The caller's latest own mutation of this entity, present only when the page was ordered by `touched_by_me`. Clients keep the touched feed ordered on this value, so it can be bumped optimistically. |
