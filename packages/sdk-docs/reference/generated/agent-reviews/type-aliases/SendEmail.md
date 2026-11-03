# Type Alias: SendEmail

> **SendEmail** = \{ `attachments?`: [`EmailAttachment`](EmailAttachment.md)[]; `bcc?`: [`EmailRecipient`](EmailRecipient.md)[]; `body`: `string`; `cc?`: [`EmailRecipient`](EmailRecipient.md)[]; `from?`: `string` \| `null`; `includeSignature?`: `boolean` \| `null`; `replyingToId?`: `string` \| `null`; `subject`: `string`; `to`: [`EmailRecipient`](EmailRecipient.md)[]; \}

Compose and send an email. Creates a draft and immediately queues it for delivery.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments?` | [`EmailAttachment`](EmailAttachment.md)[] | Macro documents to attach as files (optional). Each must be an uploaded file the user can view; together they may total 18 MB. |
| <a id="property-bcc"></a> `bcc?` | [`EmailRecipient`](EmailRecipient.md)[] | Blind carbon copy recipients (optional). |
| <a id="property-body"></a> `body` | `string` | The body of the email, written as Markdown. A host with a composer (chat) replaces this with the base64url-encoded HTML the composer exported before the tool runs; a host without one (an agent session) leaves the Markdown, and this tool renders it the same way. |
| <a id="property-cc"></a> `cc?` | [`EmailRecipient`](EmailRecipient.md)[] | Carbon copy recipients (optional). |
| <a id="property-from"></a> `from?` | `string` \| `null` | The address of the inbox to send from, when the user has more than one connected and this email belongs to a particular one. Use the exact `emailAddress` of a connected inbox — `ListInboxes` lists them, and `GetThread` reports the `inbox` a thread belongs to. Omit it unless you know which inbox is right: a reply then goes out from the inbox that received the message it answers, and a new email from the user's primary inbox. The user can change it in the composer either way. |
| <a id="property-includesignature"></a> `includeSignature?` | `boolean` \| `null` | Per-message signature override, set by the composer's signature preview — not normally by you. Omit to use the inbox's default policy (always on a new email; on replies/forwards only when the user enabled it). `false` excludes the signature for this one email. |
| <a id="property-replyingtoid"></a> `replyingToId?` | `string` \| `null` | The ID of a message to reply to (optional). When set, the email is sent as a reply within the same thread. |
| <a id="property-subject"></a> `subject` | `string` | The subject line of the email. |
| <a id="property-to"></a> `to` | [`EmailRecipient`](EmailRecipient.md)[] | The primary recipients (To field). |
