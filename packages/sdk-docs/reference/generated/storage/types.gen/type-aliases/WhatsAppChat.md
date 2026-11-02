# Type Alias: WhatsAppChat

> **WhatsAppChat** = \{ `added?`: `null` \| [`ExternalChatReference`](ExternalChatReference.md); `archived`: `boolean`; `canAdd`: `boolean`; `cannotAddReason?`: `null` \| [`WhatsAppCannotAdd`](WhatsAppCannotAdd.md); `community?`: `null` \| [`ExternalChatCommunity`](ExternalChatCommunity.md); `jid`: `string`; `kind`: [`ExternalChatKind`](ExternalChatKind.md); `lastActivityAt?`: `string` \| `null`; `name`: `string`; `phoneNumber?`: `string` \| `null`; `pinned`: `boolean`; `shared?`: `null` \| [`SharedExternalChatReference`](SharedExternalChatReference.md); \}

One chat of the caller's WhatsApp chat list, as WhatsApp Web lists it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-added"></a> `added?` | `null` \| [`ExternalChatReference`](ExternalChatReference.md) | - |
| <a id="property-archived"></a> `archived` | `boolean` | Archived in WhatsApp. |
| <a id="property-canadd"></a> `canAdd` | `boolean` | "Add to Macro" works now. |
| <a id="property-cannotaddreason"></a> `cannotAddReason?` | `null` \| [`WhatsAppCannotAdd`](WhatsAppCannotAdd.md) | - |
| <a id="property-community"></a> `community?` | `null` \| [`ExternalChatCommunity`](ExternalChatCommunity.md) | - |
| <a id="property-jid"></a> `jid` | `string` | WhatsApp chat JID: a group, or the other person's phone-number JID (LID when WhatsApp never told us the number). |
| <a id="property-kind"></a> `kind` | [`ExternalChatKind`](ExternalChatKind.md) | Group or direct chat. |
| <a id="property-lastactivityat"></a> `lastActivityAt?` | `string` \| `null` | Newest activity WhatsApp reported (message or history sync); `null` when unknown, as for saved contacts never messaged. The list is sorted by it, newest first, unknown last. |
| <a id="property-name"></a> `name` | `string` | Group: the subject, or member names for an unnamed group. Direct: the contact or WhatsApp name, else `+<phone>`. Always non-empty. |
| <a id="property-phonenumber"></a> `phoneNumber?` | `string` \| `null` | The other person's phone number (`+<digits>`) of a direct chat, when WhatsApp told us it. |
| <a id="property-pinned"></a> `pinned` | `boolean` | Pinned in WhatsApp. |
| <a id="property-shared"></a> `shared?` | `null` \| [`SharedExternalChatReference`](SharedExternalChatReference.md) | - |
