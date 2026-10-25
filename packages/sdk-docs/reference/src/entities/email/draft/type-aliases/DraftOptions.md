# Type Alias: DraftOptions

> **DraftOptions** = `Omit`\<[`ApiDraftInput`](../../../../../generated/email/types.gen/type-aliases/ApiDraftInput.md), `"db_id"` \| `"provider_id"` \| `"provider_thread_id"` \| `"replying_to_id"` \| `"thread_db_id"` \| `"body_text"` \| `"body_html"` \| `"body_macro"` \| `"headers_json"` \| `"include_signature"` \| `"draft_generation"`\> & \{ `bodyHtml?`: `string`; `bodyMacro?`: `string`; `bodyText?`: `string`; `draftGeneration?`: `number`; `headers?`: [`ApiDraftInput`](../../../../../generated/email/types.gen/type-aliases/ApiDraftInput.md)\[`"headers_json"`\]; `includeSignature?`: `boolean`; `replyingTo?`: [`EmailMessage`](../../message/classes/EmailMessage.md); `thread?`: [`EmailThread`](../../thread/classes/EmailThread.md); \}

Draft content; relationships use message and thread handles.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `bodyHtml?` | `string` | HTML body. |
| `bodyMacro?` | `string` | Macro body. |
| `bodyText?` | `string` | Plain text body. |
| `draftGeneration?` | `number` | Generation captured when editing began; defaults to the loaded draft. |
| `headers?` | [`ApiDraftInput`](../../../../../generated/email/types.gen/type-aliases/ApiDraftInput.md)\[`"headers_json"`\] | Extra headers. |
| `includeSignature?` | `boolean` | Include the inbox signature. |
| `replyingTo?` | [`EmailMessage`](../../message/classes/EmailMessage.md) | Message being replied to. |
| `thread?` | [`EmailThread`](../../thread/classes/EmailThread.md) | Thread receiving this draft. |
