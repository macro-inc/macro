# Type Alias: MessageTopicEvent

> **MessageTopicEvent** = \{ `event_type`: `"message.posted"`; `metadata`: [`MessagePostedMetadata`](MessagePostedMetadata.md); \} \| \{ `event_type`: `"message.patched"`; `metadata`: [`MessagePatchedMetadata`](MessagePatchedMetadata.md); \} \| \{ `event_type`: `"message.deleted"`; `metadata`: [`MessageDeletedMetadata`](MessageDeletedMetadata.md); \} \| \{ `event_type`: `"message.mentioned"`; `metadata`: [`MessageMentionedMetadata`](MessageMentionedMetadata.md); \} \| \{ `event_type`: `"message.attachment_created"`; `metadata`: [`MessageAttachmentCreatedMetadata`](MessageAttachmentCreatedMetadata.md); \} \| \{ `event_type`: `"message.attachment_removed"`; `metadata`: [`MessageAttachmentRemovedMetadata`](MessageAttachmentRemovedMetadata.md); \}

Lifecycle events for the common message service, one per committed fact.
Reactions and typing never reach the topic.

## Union Members

### Type Literal

\{ `event_type`: `"message.posted"`; `metadata`: [`MessagePostedMetadata`](MessagePostedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"message.posted"` | - |
| `metadata` | [`MessagePostedMetadata`](MessagePostedMetadata.md) | A user or bot posted a root or reply. |

***

### Type Literal

\{ `event_type`: `"message.patched"`; `metadata`: [`MessagePatchedMetadata`](MessagePatchedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"message.patched"` | - |
| `metadata` | [`MessagePatchedMetadata`](MessagePatchedMetadata.md) | A message's content was patched. |

***

### Type Literal

\{ `event_type`: `"message.deleted"`; `metadata`: [`MessageDeletedMetadata`](MessageDeletedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"message.deleted"` | - |
| `metadata` | [`MessageDeletedMetadata`](MessageDeletedMetadata.md) | A message was tombstoned. |

***

### Type Literal

\{ `event_type`: `"message.mentioned"`; `metadata`: [`MessageMentionedMetadata`](MessageMentionedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"message.mentioned"` | - |
| `metadata` | [`MessageMentionedMetadata`](MessageMentionedMetadata.md) | An entity (user, bot, document, …) was mentioned in a posted message. |

***

### Type Literal

\{ `event_type`: `"message.attachment_created"`; `metadata`: [`MessageAttachmentCreatedMetadata`](MessageAttachmentCreatedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"message.attachment_created"` | - |
| `metadata` | [`MessageAttachmentCreatedMetadata`](MessageAttachmentCreatedMetadata.md) | Attachments were added to a message. |

***

### Type Literal

\{ `event_type`: `"message.attachment_removed"`; `metadata`: [`MessageAttachmentRemovedMetadata`](MessageAttachmentRemovedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"message.attachment_removed"` | - |
| `metadata` | [`MessageAttachmentRemovedMetadata`](MessageAttachmentRemovedMetadata.md) | Attachments were removed from a message. |
