# Type Alias: EmailMessage

> **EmailMessage** = \{ `from`: `string`; `messageId`: `string`; `preview?`: `string` \| `null`; `receivedAt`: `string`; `subject?`: `string` \| `null`; `text?`: `string` \| `null`; `threadId`: `string`; `to`: `string`[]; \}

One email in an agent's mailbox.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-from"></a> `from` | `string` | Sender. |
| <a id="property-messageid"></a> `messageId` | `string` | Provider message id. |
| <a id="property-preview"></a> `preview?` | `string` \| `null` | Short preview of the body. |
| <a id="property-receivedat"></a> `receivedAt` | `string` | When the provider received or sent it. |
| <a id="property-subject"></a> `subject?` | `string` \| `null` | Subject line. |
| <a id="property-text"></a> `text?` | `string` \| `null` | Plain-text body, when fetched individually. |
| <a id="property-threadid"></a> `threadId` | `string` | Provider thread id. |
| <a id="property-to"></a> `to` | `string`[] | Recipients. |
