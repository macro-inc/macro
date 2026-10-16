# Type Alias: SimpleEmailSearchResponseBaseItem

> **SimpleEmailSearchResponseBaseItem** = \{ `bcc`: `string`[]; `cc`: `string`[]; `highlight`: [`SearchHighlight`](SearchHighlight.md); `labels`: `string`[]; `link_id`: `string`; `message_id`: `string`; `recipients`: `string`[]; `sender`: `string`; `sent_at?`: `null` \| `string`; `subject?`: `string` \| `null`; `thread_id`: `string`; `updated_at`: `string`; `user_id`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc` | `string`[] | The bcc |
| <a id="property-cc"></a> `cc` | `string`[] | The cc |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The highlights on the email |
| <a id="property-labels"></a> `labels` | `string`[] | The labels |
| <a id="property-link_id"></a> `link_id` | `string` | The link id |
| <a id="property-message_id"></a> `message_id` | `string` | The message id |
| <a id="property-recipients"></a> `recipients` | `string`[] | The recipients |
| <a id="property-sender"></a> `sender` | `string` | The sender |
| <a id="property-sent_at"></a> `sent_at?` | `null` \| `string` | The time the email was sent |
| <a id="property-subject"></a> `subject?` | `string` \| `null` | The subject |
| <a id="property-thread_id"></a> `thread_id` | `string` | The thread id |
| <a id="property-updated_at"></a> `updated_at` | `string` | DateTime<Utc> ts_seconds deserialization + RFC3339 serialization |
| <a id="property-user_id"></a> `user_id` | `string` | The user id |
