# Type Alias: MetaSendReply

> **MetaSendReply** = \{ `human_support?`: `boolean`; `idempotency_key`: `string`; `message`: [`MetaReplyContent`](MetaReplyContent.md); `reply_to?`: `null` \| [`MetaProviderId`](MetaProviderId.md); \}

Explicit send action; ordinary channel posts never call this boundary.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-human_support"></a> `human_support?` | `boolean` | Explicit human support action, never inferred from closing the window. |
| <a id="property-idempotency_key"></a> `idempotency_key` | `string` | Stable client intent key. A changed payload with this key is a conflict. |
| <a id="property-message"></a> `message` | [`MetaReplyContent`](MetaReplyContent.md) | Message payload, subject to provider-specific validation. |
| <a id="property-reply_to"></a> `reply_to?` | `null` \| [`MetaProviderId`](MetaProviderId.md) | - |
