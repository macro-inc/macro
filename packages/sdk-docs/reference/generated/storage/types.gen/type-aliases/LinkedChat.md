# Type Alias: LinkedChat

> **LinkedChat** = \{ `archived`: `boolean`; `can_add`: `boolean`; `cannot_add_reason?`: `string` \| `null`; `group?`: `null` \| [`LinkedGroupReference`](LinkedGroupReference.md); `jid`: `string`; `kind`: [`LinkedChatKind`](LinkedChatKind.md); `last_activity_at?`: `string` \| `null`; `name`: `string`; `pinned`: `boolean`; `shared?`: `null` \| [`LinkedSharedGroupReference`](LinkedSharedGroupReference.md); \}

One chat of the caller's WhatsApp chat list, as WhatsApp Web lists it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-archived"></a> `archived` | `boolean` | Archived in WhatsApp. |
| <a id="property-can_add"></a> `can_add` | `boolean` | "Add to Macro" works now. |
| <a id="property-cannot_add_reason"></a> `cannot_add_reason?` | `string` \| `null` | Why it can't be added, when it is neither added, shared nor addable. |
| <a id="property-group"></a> `group?` | `null` \| [`LinkedGroupReference`](LinkedGroupReference.md) | - |
| <a id="property-jid"></a> `jid` | `string` | WhatsApp chat JID: a group, or the other person's phone-number JID (LID when WhatsApp never told us the number). |
| <a id="property-kind"></a> `kind` | [`LinkedChatKind`](LinkedChatKind.md) | Group or direct chat. |
| <a id="property-last_activity_at"></a> `last_activity_at?` | `string` \| `null` | Newest activity WhatsApp reported (message or history sync); `null` when unknown. The list is sorted by it, newest first, unknown last. |
| <a id="property-name"></a> `name` | `string` | Group: the subject, or member names for an unnamed group. Direct: the contact or WhatsApp name, else `+<phone>`. Always non-empty. |
| <a id="property-pinned"></a> `pinned` | `boolean` | Pinned in WhatsApp. |
| <a id="property-shared"></a> `shared?` | `null` \| [`LinkedSharedGroupReference`](LinkedSharedGroupReference.md) | - |
