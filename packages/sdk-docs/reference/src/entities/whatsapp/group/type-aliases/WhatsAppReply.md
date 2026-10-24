# Type Alias: WhatsAppReply

> **WhatsAppReply** = \{ `text`: `string`; `type`: `"text"`; \} \| \{ `caption?`: `string`; `type`: `"media"`; `upload`: [`WhatsAppUpload`](../../upload/classes/WhatsAppUpload.md); \} \| \{ `message`: [`WhatsAppMessage`](../../message/classes/WhatsAppMessage.md); `operation`: `"reaction"` \| `"edit"` \| `"delete"`; `text?`: `string`; `type`: `"mutation"`; \}

Deliberate content from the credential owner's own WhatsApp account.
