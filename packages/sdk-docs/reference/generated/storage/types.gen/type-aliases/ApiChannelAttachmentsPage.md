# Type Alias: ApiChannelAttachmentsPage

> **ApiChannelAttachmentsPage** = \{ `items`: [`ApiChannelAttachment`](ApiChannelAttachment.md)[]; `next_cursor?`: `string` \| `null`; \}

Paginated response of channel attachments.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-items"></a> `items` | [`ApiChannelAttachment`](ApiChannelAttachment.md)[] | Attachments on this page. |
| <a id="property-next_cursor"></a> `next_cursor?` | `string` \| `null` | Cursor for the next page, null if no more pages. |
