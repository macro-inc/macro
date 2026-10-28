# Type Alias: PushNotificationData

> **PushNotificationData** = \{ `navigation?`: `null` \| [`PushNotificationNavigation`](PushNotificationNavigation.md); `notificationId`: `string`; `recipientId?`: `string` \| `null`; `senderProfilePictureUrl?`: `string` \| `null`; \}

the value we send as the payload in the ios notification
This data is accessible to the client

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-navigation"></a> `navigation?` | `null` \| [`PushNotificationNavigation`](PushNotificationNavigation.md) | - |
| <a id="property-notificationid"></a> `notificationId` | `string` | The id of the notification record (UserNotification.id) |
| <a id="property-recipientid"></a> `recipientId?` | `string` \| `null` | Account that owns the receiving device, set during per-recipient delivery. |
| <a id="property-senderprofilepictureurl"></a> `senderProfilePictureUrl?` | `string` \| `null` | The sender's profile picture URL, used by the Notification Service Extension to download and attach as a rich notification image. |
