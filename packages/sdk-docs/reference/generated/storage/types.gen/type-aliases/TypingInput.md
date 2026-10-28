# Type Alias: TypingInput

> **TypingInput** = \{ `active`: `boolean`; `nonce?`: `string` \| `null`; `thread_id?`: `string` \| `null`; \}

Transient typing update.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-active"></a> `active` | `boolean` | Whether the caller is typing. |
| <a id="property-nonce"></a> `nonce?` | `string` \| `null` | Client mutation nonce. |
| <a id="property-thread_id"></a> `thread_id?` | `string` \| `null` | Root being replied to, absent for the parent composer. |
