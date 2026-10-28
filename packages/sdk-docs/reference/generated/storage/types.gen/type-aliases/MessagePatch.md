# Type Alias: MessagePatch

> **MessagePatch** = \{ `attachments?`: [`AttachmentChange`](AttachmentChange.md); `content?`: `string` \| `null`; `mentions?`: [`SimpleMention`](SimpleMention.md)[] \| `null`; `nonce?`: `string` \| `null`; \}

Partial updates share the same authorship, reference, and delivery rules as edits.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments?` | [`AttachmentChange`](AttachmentChange.md) | Attachment change, without adapter-side message reads. |
| <a id="property-content"></a> `content?` | `string` \| `null` | Replacement body; absent preserves current content. |
| <a id="property-mentions"></a> `mentions?` | [`SimpleMention`](SimpleMention.md)[] \| `null` | Replacement authored mentions; absent preserves current mentions. |
| <a id="property-nonce"></a> `nonce?` | `string` \| `null` | Client mutation nonce. |
