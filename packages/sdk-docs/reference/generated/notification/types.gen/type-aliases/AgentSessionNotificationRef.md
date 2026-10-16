# Type Alias: AgentSessionNotificationRef

> **AgentSessionNotificationRef** = \{ `announcementMessageId?`: `string` \| `null`; `botId`: `string`; `botName`: `string`; `channelId?`: `string` \| `null`; `parent?`: `null` \| [`AgentSessionOriginParent`](AgentSessionOriginParent.md); `sessionId`: `string`; `sessionName`: `string`; `threadId?`: `string` \| `null`; \}

Flattened into each agent-session kind so the wire keeps these keys at the
top level of the metadata, the way [`CommonChannelMetadata`] does.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-announcementmessageid"></a> `announcementMessageId?` | `string` \| `null` | The magic-chip message for the turn in question, when one was posted. |
| <a id="property-botid"></a> `botId` | `string` | The bot the session runs for. A string on the wire: system bots have fixed ids like `00000000-0000-0000-0000-00000000a2a2`, which are not RFC 4122 uuids and fail a `format: uuid` check on the client. |
| <a id="property-botname"></a> `botName` | `string` | The bot's display name; agent notifications have no user sender, so this is who they read as being from. |
| <a id="property-channelid"></a> `channelId?` | `string` \| `null` | The channel the session was opened from, when it was opened from a channel thread. |
| <a id="property-parent"></a> `parent?` | `null` \| [`AgentSessionOriginParent`](AgentSessionOriginParent.md) | - |
| <a id="property-sessionid"></a> `sessionId` | `string` | The session; what a click opens. |
| <a id="property-sessionname"></a> `sessionName` | `string` | The session's name at the time of the event. |
| <a id="property-threadid"></a> `threadId?` | `string` \| `null` | The thread the session was opened from, when it was. |
