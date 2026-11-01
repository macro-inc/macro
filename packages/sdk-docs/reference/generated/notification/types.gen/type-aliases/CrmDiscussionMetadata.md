# Type Alias: CrmDiscussionMetadata

> **CrmDiscussionMetadata** = \{ `messageId`: `string`; `reason`: [`CrmDiscussionReason`](CrmDiscussionReason.md); `recordName`: `string`; `senderDisplayName?`: `string` \| `null`; `senderProfilePictureUrl?`: `string` \| `null`; `text`: `string`; `threadId`: `string`; \}

CRM discussion metadata. The notification entity identifies the company or
contact; message and thread UUIDs select the discussion inside it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-messageid"></a> `messageId` | `string` | Canonical shared message UUID. |
| <a id="property-reason"></a> `reason` | [`CrmDiscussionReason`](CrmDiscussionReason.md) | Semantic reason selected by the message delivery domain. |
| <a id="property-recordname"></a> `recordName` | `string` | Company or contact display name. |
| <a id="property-senderdisplayname"></a> `senderDisplayName?` | `string` \| `null` | Public display name for a bot author. |
| <a id="property-senderprofilepictureurl"></a> `senderProfilePictureUrl?` | `string` \| `null` | Optional avatar for push notification attachments. |
| <a id="property-text"></a> `text` | `string` | Posted Markdown content. |
| <a id="property-threadid"></a> `threadId` | `string` | Canonical discussion root UUID. |
