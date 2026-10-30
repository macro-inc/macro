# Type Alias: EmailSearchResult

> **EmailSearchResult** = \{ `bcc`: `string`[]; `cc`: `string`[]; `highlight`: [`SearchHighlight`](SearchHighlight.md); `labels`: `string`[]; `message_id?`: `string` \| `null`; `pretty_sender`: `string`; `recipients`: `string`[]; `score?`: `number` \| `null`; `sender`: `string`; `sent_at?`: `string` \| `null`; \}

A email message match for a given thread id

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc` | `string`[] | This is only present if the search result is on the message content |
| <a id="property-cc"></a> `cc` | `string`[] | This is only present if the search result is on the message content |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The highlights for the email message |
| <a id="property-labels"></a> `labels` | `string`[] | This is only present if the search result is on the message content |
| <a id="property-message_id"></a> `message_id?` | `string` \| `null` | The email message id. This is only present if the search result is on the message content |
| <a id="property-pretty_sender"></a> `pretty_sender` | `string` | The pretty sender. If the match is on the subject, the pretty sender is the latest sender on the thread. This could be the sender's email if there is no contact name for the sender. |
| <a id="property-recipients"></a> `recipients` | `string`[] | This is only present if the search result is on the message content |
| <a id="property-score"></a> `score?` | `number` \| `null` | The score of the result |
| <a id="property-sender"></a> `sender` | `string` | The sender. If the match is on the subject, the sender is the latest sender on the thread. |
| <a id="property-sent_at"></a> `sent_at?` | `string` \| `null` | When the email message was sent This is only present if the search result is on the message content |
