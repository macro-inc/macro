# Type Alias: MetaReplyContent

> **MetaReplyContent** = \{ `text`: `string`; `type`: `"text"`; \} \| \{ `caption?`: `string` \| `null`; `document_id`: `string`; `kind`: [`MetaMediaKind`](MetaMediaKind.md); `type`: `"media"`; \} \| \{ `language`: `string`; `parameters`: `string`[]; `template_id`: [`MetaProviderId`](MetaProviderId.md); `type`: `"template"`; \}

Text, Macro-owned media or approved-template input. Remote arbitrary URLs are
not accepted from clients as attachments.

## Union Members

### Type Literal

\{ `text`: `string`; `type`: `"text"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `text` | `string` | UTF-8 text, checked against the selected provider's limit. |
| `type` | `"text"` | - |

***

### Type Literal

\{ `caption?`: `string` \| `null`; `document_id`: `string`; `kind`: [`MetaMediaKind`](MetaMediaKind.md); `type`: `"media"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `caption?` | `string` \| `null` | Optional caption, where the provider permits it. |
| `document_id` | `string` | Existing Macro document ID, authorized again by the worker. |
| `kind` | [`MetaMediaKind`](MetaMediaKind.md) | Desired provider media category. |
| `type` | `"media"` | - |

***

### Type Literal

\{ `language`: `string`; `parameters`: `string`[]; `template_id`: [`MetaProviderId`](MetaProviderId.md); `type`: `"template"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `language` | `string` | Exact approved language. |
| `parameters` | `string`[] | Ordered text parameters for header/body. Buttons and media templates are validated separately and never passed through as raw provider JSON. |
| `template_id` | [`MetaProviderId`](MetaProviderId.md) | Account-scoped provider template identity. |
| `type` | `"template"` | - |
