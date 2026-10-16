# Type Alias: ThreadOrigin

> **ThreadOrigin** = \{ `channel_id?`: `string` \| `null`; `originating_message_id`: `string`; `parent`: [`MessageParent`](MessageParent.md); `thread_id`: `string`; \}

The thread a session was opened from, when it was.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id?` | `string` \| `null` | Channel the thread lives in, for channel parents only. Kept beside `parent` for consumers written when every origin was a channel. |
| <a id="property-originating_message_id"></a> `originating_message_id` | `string` | The message whose mention opened the session. |
| <a id="property-parent"></a> `parent` | [`MessageParent`](MessageParent.md) | Entity owning the thread: the channel or document it was posted in. |
| <a id="property-thread_id"></a> `thread_id` | `string` | Root message of the thread. |
