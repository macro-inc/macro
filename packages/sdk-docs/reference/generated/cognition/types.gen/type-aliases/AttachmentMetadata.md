# Type Alias: AttachmentMetadata

> **AttachmentMetadata** = \{ `document_name`: `string`; `document_type`: [`FileType`](FileType.md); `type`: `"document"`; \} \| \{ `project_name`: `string`; `type`: `"project"`; \} \| \{ `image_extension`: [`FileType`](FileType.md); `image_name`: `string`; `type`: `"image"`; \} \| \{ `channel_name`: `string`; `channel_type`: [`ChannelType`](ChannelType.md); `type`: `"channel"`; \} \| \{ `email_subject`: `string`; `type`: `"email"`; \}

## Union Members

### Type Literal

\{ `document_name`: `string`; `document_type`: [`FileType`](FileType.md); `type`: `"document"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `document_name` | `string` | Name of the document |
| `document_type` | [`FileType`](FileType.md) | Type of the document ['pdf' \| 'docx' \| 'md'] |
| `type` | `"document"` | - |

***

### Type Literal

\{ `project_name`: `string`; `type`: `"project"`; \}

***

### Type Literal

\{ `image_extension`: [`FileType`](FileType.md); `image_name`: `string`; `type`: `"image"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `image_extension` | [`FileType`](FileType.md) | jpg \| png \| etc |
| `image_name` | `string` | image name |
| `type` | `"image"` | - |

***

### Type Literal

\{ `channel_name`: `string`; `channel_type`: [`ChannelType`](ChannelType.md); `type`: `"channel"`; \}

***

### Type Literal

\{ `email_subject`: `string`; `type`: `"email"`; \}
