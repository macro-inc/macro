# Type Alias: GetChatResponse

> **GetChatResponse** = \{ `chat`: [`ChatResponse`](ChatResponse.md); `userAccessLevel`: [`AccessLevel`](AccessLevel.md); \}

Wrapper response for get_chat, matching the DCS API response shape.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chat"></a> `chat` | [`ChatResponse`](ChatResponse.md) | The full chat data. |
| <a id="property-useraccesslevel"></a> `userAccessLevel` | [`AccessLevel`](AccessLevel.md) | The requesting user's access level on this chat. |
