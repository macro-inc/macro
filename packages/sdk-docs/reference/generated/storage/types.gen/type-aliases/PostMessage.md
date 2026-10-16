# Type Alias: PostMessage

> **PostMessage** = \{ `anchor?`: `null` \| [`NewThreadAnchor`](NewThreadAnchor.md); `attachments?`: [`NewAttachment`](NewAttachment.md)[]; `content`: `string`; `id?`: `string` \| `null`; `mentions?`: [`SimpleMention`](SimpleMention.md)[]; `nonce?`: `string` \| `null`; `thread_id?`: `string` \| `null`; \}

Create a root or reply. Thread state may only be supplied on a root.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-anchor"></a> `anchor?` | `null` \| [`NewThreadAnchor`](NewThreadAnchor.md) | - |
| <a id="property-attachments"></a> `attachments?` | [`NewAttachment`](NewAttachment.md)[] | Initial attachments. |
| <a id="property-content"></a> `content` | `string` | Macro Markdown body. |
| <a id="property-id"></a> `id?` | `string` \| `null` | Client-minted UUIDv7 for the new message, so an optimistic message already carries its final id; the server mints one when absent. |
| <a id="property-mentions"></a> `mentions?` | [`SimpleMention`](SimpleMention.md)[] | Mentions tracked by the editor. |
| <a id="property-nonce"></a> `nonce?` | `string` \| `null` | Client nonce for optimistic reconciliation. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | Root to reply to, if this is a reply. |
