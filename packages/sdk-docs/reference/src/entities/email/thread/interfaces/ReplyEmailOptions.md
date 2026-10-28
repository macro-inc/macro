# Interface: ReplyEmailOptions

Options for replying within an email thread.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc?` | [`ApiDraftContactInfo`](../../../../../generated/email/types.gen/type-aliases/ApiDraftContactInfo.md)[] | Bcc recipients. |
| <a id="property-bodytext"></a> `bodyText` | `string` | Plain-text body. |
| <a id="property-cc"></a> `cc?` | [`ApiDraftContactInfo`](../../../../../generated/email/types.gen/type-aliases/ApiDraftContactInfo.md)[] | Cc recipients. |
| <a id="property-replyingto"></a> `replyingTo?` | [`EmailMessage`](../../message/classes/EmailMessage.md) | The message being replied to. |
| <a id="property-subject"></a> `subject?` | `string` | Subject line. Defaults to the subject of the thread's first message. |
| <a id="property-to"></a> `to` | [`ApiDraftContactInfo`](../../../../../generated/email/types.gen/type-aliases/ApiDraftContactInfo.md)[] | Recipients. |
