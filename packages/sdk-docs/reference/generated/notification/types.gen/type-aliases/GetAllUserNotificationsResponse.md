# Type Alias: GetAllUserNotificationsResponse

> **GetAllUserNotificationsResponse** = \{ `items`: [`ApiUserNotification`](ApiUserNotification.md)[]; `next_cursor?`: `string` \| `null`; \}

The strongly typed response for listing user notifications.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-items"></a> `items` | [`ApiUserNotification`](ApiUserNotification.md)[] | The list of items returned. |
| <a id="property-next_cursor"></a> `next_cursor?` | `string` \| `null` | The next page cursor if it exists. |
