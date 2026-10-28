# Type Alias: InitiativeDiscussionMetadata

> **InitiativeDiscussionMetadata** = \{ `messageId`: `string`; `owner`: `string`; `projectName`: `string`; `reason`: [`InitiativeDiscussionReason`](InitiativeDiscussionReason.md); `senderDisplayName?`: `string` \| `null`; `senderProfilePictureUrl?`: `string` \| `null`; `text`: `string`; `threadId`: `string`; \}

Project discussion metadata. The notification entity identifies the initiative;
message and thread UUIDs select the discussion inside that project.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-messageid"></a> `messageId` | `string` | Canonical shared message UUID. |
| <a id="property-owner"></a> `owner` | `string` | Authenticated project owner. |
| <a id="property-projectname"></a> `projectName` | `string` | Name displayed in the project header. |
| <a id="property-reason"></a> `reason` | [`InitiativeDiscussionReason`](InitiativeDiscussionReason.md) | Semantic reason selected by the message delivery domain. |
| <a id="property-senderdisplayname"></a> `senderDisplayName?` | `string` \| `null` | Public display name for a bot author. |
| <a id="property-senderprofilepictureurl"></a> `senderProfilePictureUrl?` | `string` \| `null` | Optional avatar for push notification attachments. |
| <a id="property-text"></a> `text` | `string` | Posted Markdown content. |
| <a id="property-threadid"></a> `threadId` | `string` | Canonical discussion root UUID. |
