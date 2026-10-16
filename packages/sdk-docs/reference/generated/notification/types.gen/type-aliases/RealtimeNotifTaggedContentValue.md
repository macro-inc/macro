# Type Alias: RealtimeNotifTaggedContentValue

> **RealtimeNotifTaggedContentValue** = [`Entity`](Entity.md) & \{ `created_at`: `string`; `deleted_at?`: `string` \| `null`; `notification_event_type`: `string`; `notification_id`: `string`; `notification_metadata`: \{ `content`: `unknown`; `tag`: [`NotificationTypeName`](NotificationTypeName.md); \}; `sender_id?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `sent`: `boolean`; `state`: [`NotificationState`](NotificationState.md); `updated_at`: `string`; `viewed_at?`: `string` \| `null`; \}

the value of the inner payload inside [ConnGatewayNotification]

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `created_at` | `string` | When the notification was created. |
| `deleted_at?` | `string` \| `null` | When the notification was deleted. |
| `notification_event_type` | `string` | The notification event type string (e.g. "channel_mention"). TODO make this a new type |
| `notification_id` | `string` | The notification ID. |
| `notification_metadata` | \{ `content`: `unknown`; `tag`: [`NotificationTypeName`](NotificationTypeName.md); \} | A notification metadata value tagged with the notification event type. |
| `notification_metadata.content` | `unknown` | - |
| `notification_metadata.tag` | [`NotificationTypeName`](NotificationTypeName.md) | - |
| `sender_id?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| `sent` | `boolean` | Whether the notification has been sent. |
| `state` | [`NotificationState`](NotificationState.md) | The authoritative lifecycle state, independent of viewing timestamps. |
| `updated_at` | `string` | When the notification was last updated. |
| `viewed_at?` | `string` \| `null` | When the notification was viewed/seen. |
