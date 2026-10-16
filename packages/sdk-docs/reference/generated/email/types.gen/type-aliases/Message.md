# Type Alias: Message

> **Message** = \{ `attachments`: [`Attachment`](Attachment.md)[]; `attachments_draft`: [`AttachmentDraft`](AttachmentDraft.md)[]; `attachments_forwarded`: [`AttachmentForwarded`](AttachmentForwarded.md)[]; `bcc`: [`ContactInfo`](ContactInfo.md)[]; `body_html_sanitized?`: `string` \| `null`; `body_macro?`: `string` \| `null`; `body_text?`: `string` \| `null`; `cc`: [`ContactInfo`](ContactInfo.md)[]; `created_at`: `string`; `db_id`: `string`; `from?`: `null` \| [`ContactInfo`](ContactInfo.md); `global_id?`: `string` \| `null`; `has_attachments`: `boolean`; `headers_json?`: `null` \| [`Value`](Value.md); `internal_date_ts?`: `string` \| `null`; `is_draft`: `boolean`; `is_read`: `boolean`; `is_sent`: `boolean`; `is_starred`: `boolean`; `labels`: [`Label`](Label.md)[]; `link_id`: `string`; `provider_history_id?`: `string` \| `null`; `provider_id?`: `string` \| `null`; `provider_thread_id?`: `string` \| `null`; `replying_to_id?`: `string` \| `null`; `scheduled_send_time?`: `string` \| `null`; `sent_at?`: `string` \| `null`; `size_estimate?`: `number` \| `null`; `snippet?`: `string` \| `null`; `subject?`: `string` \| `null`; `thread_db_id`: `string`; `to`: [`ContactInfo`](ContactInfo.md)[]; `updated_at`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments` | [`Attachment`](Attachment.md)[] | - |
| <a id="property-attachments_draft"></a> `attachments_draft` | [`AttachmentDraft`](AttachmentDraft.md)[] | Uploaded file attachments for the message, if it is a draft |
| <a id="property-attachments_forwarded"></a> `attachments_forwarded` | [`AttachmentForwarded`](AttachmentForwarded.md)[] | Forwarded attachments from original messages, if it is a draft |
| <a id="property-bcc"></a> `bcc` | [`ContactInfo`](ContactInfo.md)[] | - |
| <a id="property-body_html_sanitized"></a> `body_html_sanitized?` | `string` \| `null` | - |
| <a id="property-body_macro"></a> `body_macro?` | `string` \| `null` | - |
| <a id="property-body_text"></a> `body_text?` | `string` \| `null` | - |
| <a id="property-cc"></a> `cc` | [`ContactInfo`](ContactInfo.md)[] | - |
| <a id="property-created_at"></a> `created_at` | `string` | - |
| <a id="property-db_id"></a> `db_id` | `string` | - |
| <a id="property-from"></a> `from?` | `null` \| [`ContactInfo`](ContactInfo.md) | - |
| <a id="property-global_id"></a> `global_id?` | `string` \| `null` | The globally unique Message-ID header value created by the sender to uniquely identify this email Used for threading across all providers (In-Reply-To header, References header) |
| <a id="property-has_attachments"></a> `has_attachments` | `boolean` | - |
| <a id="property-headers_json"></a> `headers_json?` | `null` \| [`Value`](Value.md) | - |
| <a id="property-internal_date_ts"></a> `internal_date_ts?` | `string` \| `null` | - |
| <a id="property-is_draft"></a> `is_draft` | `boolean` | - |
| <a id="property-is_read"></a> `is_read` | `boolean` | - |
| <a id="property-is_sent"></a> `is_sent` | `boolean` | - |
| <a id="property-is_starred"></a> `is_starred` | `boolean` | - |
| <a id="property-labels"></a> `labels` | [`Label`](Label.md)[] | - |
| <a id="property-link_id"></a> `link_id` | `string` | - |
| <a id="property-provider_history_id"></a> `provider_history_id?` | `string` \| `null` | - |
| <a id="property-provider_id"></a> `provider_id?` | `string` \| `null` | - |
| <a id="property-provider_thread_id"></a> `provider_thread_id?` | `string` \| `null` | - |
| <a id="property-replying_to_id"></a> `replying_to_id?` | `string` \| `null` | - |
| <a id="property-scheduled_send_time"></a> `scheduled_send_time?` | `string` \| `null` | - |
| <a id="property-sent_at"></a> `sent_at?` | `string` \| `null` | - |
| <a id="property-size_estimate"></a> `size_estimate?` | `number` \| `null` | - |
| <a id="property-snippet"></a> `snippet?` | `string` \| `null` | - |
| <a id="property-subject"></a> `subject?` | `string` \| `null` | - |
| <a id="property-thread_db_id"></a> `thread_db_id` | `string` | - |
| <a id="property-to"></a> `to` | [`ContactInfo`](ContactInfo.md)[] | - |
| <a id="property-updated_at"></a> `updated_at` | `string` | - |
