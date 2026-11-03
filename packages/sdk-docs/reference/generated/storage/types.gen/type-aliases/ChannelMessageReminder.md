# Type Alias: ChannelMessageReminder

> **ChannelMessageReminder** = \{ `channelId`: `string`; `description`: `string`; `messageId`: `string`; `remindAt`: `string`; `reminderId`: `string`; `threadId?`: `string` \| `null`; \}

An active reminder on one channel message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channelid"></a> `channelId` | `string` | Channel the message belongs to. |
| <a id="property-description"></a> `description` | `string` | Snippet shown in the notification. |
| <a id="property-messageid"></a> `messageId` | `string` | Message to open when the reminder fires. |
| <a id="property-remindat"></a> `remindAt` | `string` | When to notify the owner. |
| <a id="property-reminderid"></a> `reminderId` | `string` | Reminder row. |
| <a id="property-threadid"></a> `threadId?` | `string` \| `null` | Thread root when the message is a reply. |
