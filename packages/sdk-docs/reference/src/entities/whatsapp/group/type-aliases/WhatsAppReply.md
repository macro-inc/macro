# Type Alias: WhatsAppReply

> **WhatsAppReply** = \{ `mentions?`: `string`[]; `text`: `string`; `type`: `"text"`; \} \| \{ `caption?`: `string`; `type`: `"media"`; `upload`: [`WhatsAppUpload`](../../upload/classes/WhatsAppUpload.md); \} \| \{ `message`: [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md); `operation`: `"reaction"` \| `"edit"` \| `"delete"`; `text?`: `string`; `type`: `"mutation"`; \}

Deliberate content from the credential owner's own WhatsApp account.

## Union Members

### Type Literal

\{ `mentions?`: `string`[]; `text`: `string`; `type`: `"text"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `mentions?` | `string`[] | WhatsApp ids of mentioned participants (`roster.participants[].jid`); the text names each as `@<digits>`. |
| `text` | `string` | - |
| `type` | `"text"` | - |

***

### Type Literal

\{ `caption?`: `string`; `type`: `"media"`; `upload`: [`WhatsAppUpload`](../../upload/classes/WhatsAppUpload.md); \}

***

### Type Literal

\{ `message`: [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md); `operation`: `"reaction"` \| `"edit"` \| `"delete"`; `text?`: `string`; `type`: `"mutation"`; \}
