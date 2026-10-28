# Type Alias: RefreshEmailEvent

> **RefreshEmailEvent** = \{ `event`: `"backfill"`; `link_id`: `string`; `status`: [`BackfillStatus`](BackfillStatus.md); \} \| \{ `event`: `"upsert_message"`; `link_id`: `string`; \} \| \{ `event`: `"update_labels"`; `link_id`: `string`; \} \| \{ `event`: `"delete_message"`; `link_id`: `string`; \} \| \{ `event`: `"link_removed"`; `link_id`: `string`; \} \| \{ `event`: `"photo_synced"`; `link_id`: `string`; \} \| \{ `completed_threads`: `number`; `event`: `"backfill_progress"`; `link_id`: `string`; `status`: [`BackfillStatus`](BackfillStatus.md); `total_threads`: `number`; \}

Payload for the `refresh_email` connection gateway event: identifies the
inbox that changed and the kind of change.
