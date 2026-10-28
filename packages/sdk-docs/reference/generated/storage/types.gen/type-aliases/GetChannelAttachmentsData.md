# Type Alias: GetChannelAttachmentsData

> **GetChannelAttachmentsData** = \{ `body?`: `never`; `path`: \{ `channel_id`: `string`; \}; `query?`: \{ `attachment_type?`: `string`; `cursor?`: `string`; `limit?`: `number`; \}; `url`: `"/channels/{channel_id}/attachments"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `channel_id`: `string`; \} | - |
| `path.channel_id` | `string` | Channel ID |
| <a id="property-query"></a> `query?` | \{ `attachment_type?`: `string`; `cursor?`: `string`; `limit?`: `number`; \} | - |
| `query.attachment_type?` | `string` | Filter by type: 'static' for images/videos, 'dss' for documents |
| `query.cursor?` | `string` | Base64 encoded cursor value |
| `query.limit?` | `number` | Page size (1-500, default 50) |
| <a id="property-url"></a> `url` | `"/channels/{channel_id}/attachments"` | - |
