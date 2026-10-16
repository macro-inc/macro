# Type Alias: ApiDraftInput

> **ApiDraftInput** = \{ `bcc?`: [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null`; `body_html?`: `string` \| `null`; `body_macro?`: `string` \| `null`; `body_text?`: `string` \| `null`; `cc?`: [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null`; `db_id?`: `string` \| `null`; `headers_json?`: `null` \| [`Value`](Value.md); `include_signature?`: `boolean` \| `null`; `provider_id?`: `string` \| `null`; `provider_thread_id?`: `string` \| `null`; `replying_to_id?`: `string` \| `null`; `subject`: `string`; `thread_db_id?`: `string` \| `null`; `to?`: [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null`; \}

The draft input matching the current `MessageToSend` JSON shape for backward compat.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc?` | [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null` | Bcc recipients. |
| <a id="property-body_html"></a> `body_html?` | `string` \| `null` | HTML body (base64 URL_SAFE_NO_PAD encoded). Sanitized before storage. |
| <a id="property-body_macro"></a> `body_macro?` | `string` \| `null` | Macro body format. |
| <a id="property-body_text"></a> `body_text?` | `string` \| `null` | Plain text body. |
| <a id="property-cc"></a> `cc?` | [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null` | Cc recipients. |
| <a id="property-db_id"></a> `db_id?` | `string` \| `null` | Existing message DB ID (for updating an existing draft). |
| <a id="property-headers_json"></a> `headers_json?` | `null` \| [`Value`](Value.md) | - |
| <a id="property-include_signature"></a> `include_signature?` | `boolean` \| `null` | Per-message override for whether to include the signature on send: `Some(false)` to exclude (user dismissed it). Omit to use the inbox's default policy. Ignored for drafts. |
| <a id="property-provider_id"></a> `provider_id?` | `string` \| `null` | Provider message ID. |
| <a id="property-provider_thread_id"></a> `provider_thread_id?` | `string` \| `null` | Provider thread ID. |
| <a id="property-replying_to_id"></a> `replying_to_id?` | `string` \| `null` | ID of the message this draft is replying to. |
| <a id="property-subject"></a> `subject` | `string` | Subject line. |
| <a id="property-thread_db_id"></a> `thread_db_id?` | `string` \| `null` | Thread DB ID. |
| <a id="property-to"></a> `to?` | [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null` | To recipients. |
