# Type Alias: PushNotificationNavigation

> **PushNotificationNavigation** = \{ `channelId`: `string`; `messageId`: `string`; `threadId`: `string` \| `null`; `type`: `"channel"`; \}

Open a channel at a specific message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channelid"></a> `channelId` | `string` | Channel containing the message. |
| <a id="property-messageid"></a> `messageId` | `string` | Message to highlight. |
| <a id="property-threadid"></a> `threadId` | `string` \| `null` | Root of the message's thread; null identifies a top-level message. |
| <a id="property-type"></a> `type` | `"channel"` | - |
