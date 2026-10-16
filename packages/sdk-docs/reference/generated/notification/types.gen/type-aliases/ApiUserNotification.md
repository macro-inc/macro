# Type Alias: ApiUserNotification

> **ApiUserNotification** = [`Entity`](Entity.md) & \{ `created_at`: `string`; `deleted_at?`: `string` \| `null`; `id`: `string`; `notification_event_type`: `string`; `notification_metadata`: [`NotifEvent`](NotifEvent.md); `owner_id`: `string`; `sender_id?`: `string` \| `null`; `sent`: `boolean`; `state`: [`NotificationState`](NotificationState.md); `updated_at`: `string`; `viewed_at?`: `string` \| `null`; \}

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `created_at` | `string` | When the notification was created. |
| `deleted_at?` | `string` \| `null` | When the notification was deleted. |
| `id` | `string` | The notification ID. |
| `notification_event_type` | `string` | The notification event type string (e.g. "channel_mention"). TODO make this a new type |
| `notification_metadata` | [`NotifEvent`](NotifEvent.md) | Deserialized notification metadata. |
| `owner_id` | `string` | The user who owns this notification. |
| `sender_id?` | `string` \| `null` | The user who triggered the notification. |
| `sent` | `boolean` | Whether the notification has been sent. |
| `state` | [`NotificationState`](NotificationState.md) | The authoritative notification lifecycle state. |
| `updated_at` | `string` | When the notification was last updated. |
| `viewed_at?` | `string` \| `null` | When the notification was viewed/seen. |
