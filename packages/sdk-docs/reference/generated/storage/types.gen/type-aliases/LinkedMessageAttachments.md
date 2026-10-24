# Type Alias: LinkedMessageAttachments

> **LinkedMessageAttachments** = \{ `linked_attachments`: [`LinkedAttachment`](LinkedAttachment.md)[]; `message_id`: `string`; \}

The attachments of one linked group message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-linked_attachments"></a> `linked_attachments` | [`LinkedAttachment`](LinkedAttachment.md)[] | Its attachments in order; deleted ones are omitted. |
| <a id="property-message_id"></a> `message_id` | `string` | Group message. |
