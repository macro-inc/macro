# Type Alias: CreateSessionThread

> **CreateSessionThread** = \{ `channelId?`: `string` \| `null`; `content?`: `string`; `messageId`: `string`; `parent?`: `null` \| [`MessageParent`](MessageParent.md); `reuseOriginMessage?`: `boolean`; `threadId?`: `string` \| `null`; \}

The triggering mention on a create request.

Clients serialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channelid"></a> `channelId?` | `string` \| `null` | Channel the mentioning message was posted in. Runtimes built before message parents send this instead of `parent`. |
| <a id="property-content"></a> `content?` | `string` | The mention's text, quoted in the session's announcement. |
| <a id="property-messageid"></a> `messageId` | `string` | The mentioning message. |
| <a id="property-parent"></a> `parent?` | `null` \| [`MessageParent`](MessageParent.md) | - |
| <a id="property-reuseoriginmessage"></a> `reuseOriginMessage?` | `boolean` | Update the existing bot response reserved by a task assignment. |
| <a id="property-threadid"></a> `threadId?` | `string` \| `null` | Thread the session belongs to; defaults to the message itself, which is how a top-level mention roots its own thread. |
