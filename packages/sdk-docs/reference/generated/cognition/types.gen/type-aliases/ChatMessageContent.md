# Type Alias: ChatMessageContent

> **ChatMessageContent** = `string` \| [`AssistantMessagePart`](AssistantMessagePart.md)[]

The content of a [`ChatMessage`].

For user and system messages the content is plain [`Text`](Self::Text).
For assistant messages it may additionally be a sequence of
[`AssistantMessagePart`]s that encode tool-call round trips.
