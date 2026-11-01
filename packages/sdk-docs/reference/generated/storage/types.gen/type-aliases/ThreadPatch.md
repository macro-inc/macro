# Type Alias: ThreadPatch

> **ThreadPatch** = \{ `detach_anchor?`: `boolean`; `nonce?`: `string` \| `null`; `resolved?`: `boolean` \| `null`; \}

Partial changes to discussion lifecycle or document anchor placement.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-detach_anchor"></a> `detach_anchor?` | `boolean` | Move a Markdown discussion to the document when its marked text is removed. |
| <a id="property-nonce"></a> `nonce?` | `string` \| `null` | Client nonce for the shared thread update event. |
| <a id="property-resolved"></a> `resolved?` | `boolean` \| `null` | Resolve or reopen the discussion; absent preserves its state. |
