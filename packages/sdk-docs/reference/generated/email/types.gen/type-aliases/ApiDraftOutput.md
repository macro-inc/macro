# Type Alias: ApiDraftOutput

> **ApiDraftOutput** = \{ `bcc?`: [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null`; `body_html?`: `string` \| `null`; `body_macro?`: `string` \| `null`; `body_text?`: `string` \| `null`; `cc?`: [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null`; `db_id?`: `string` \| `null`; `draft_generation`: `number`; `headers_json?`: `null` \| [`Value`](Value.md); `link_id`: `string`; `provider_id?`: `string` \| `null`; `provider_thread_id?`: `string` \| `null`; `replying_to_id?`: `string` \| `null`; `send_time?`: `string` \| `null`; `subject`: `string`; `thread_db_id?`: `string` \| `null`; `to?`: [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null`; \}

The draft output matching the current `MessageToSend` JSON shape for backward compat.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc?` | [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null` | Bcc recipients. |
| <a id="property-body_html"></a> `body_html?` | `string` \| `null` | HTML body (decoded). |
| <a id="property-body_macro"></a> `body_macro?` | `string` \| `null` | Macro body. |
| <a id="property-body_text"></a> `body_text?` | `string` \| `null` | Plain text body. |
| <a id="property-cc"></a> `cc?` | [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null` | Cc recipients. |
| <a id="property-db_id"></a> `db_id?` | `string` \| `null` | Message DB ID. |
| <a id="property-draft_generation"></a> `draft_generation` | `number` | Generation required for subsequent edits. |
| <a id="property-headers_json"></a> `headers_json?` | `null` \| [`Value`](Value.md) | - |
| <a id="property-link_id"></a> `link_id` | `string` | Link ID. |
| <a id="property-provider_id"></a> `provider_id?` | `string` \| `null` | Provider message ID. |
| <a id="property-provider_thread_id"></a> `provider_thread_id?` | `string` \| `null` | Provider thread ID. |
| <a id="property-replying_to_id"></a> `replying_to_id?` | `string` \| `null` | ID of the message this draft is replying to. |
| <a id="property-send_time"></a> `send_time?` | `string` \| `null` | Send time. |
| <a id="property-subject"></a> `subject` | `string` | Subject line. |
| <a id="property-thread_db_id"></a> `thread_db_id?` | `string` \| `null` | Thread DB ID. |
| <a id="property-to"></a> `to?` | [`ApiDraftContactInfo`](ApiDraftContactInfo.md)[] \| `null` | To recipients. |
