# Type Alias: AgentSessionFoldedLogResponse

> **AgentSessionFoldedLogResponse** = \{ `bot`: [`SessionBot`](SessionBot.md); `messages`: \{\[`key`: `string`\]: `unknown`; \}[]; \}

Response body for one session's folded log.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bot"></a> `bot` | [`SessionBot`](SessionBot.md) | The agent whose messages these are; it sent every agent message. |
| <a id="property-messages"></a> `messages` | \{\[`key`: `string`\]: `unknown`; \}[] | The conversation, oldest first: prompts, replies, tool calls and their results, plans, permission requests and how each turn ended. Each element is a `FoldedMessage` from the fold's TypeScript contract, which the SDK exports; the schema is opaque here because those types are described with specta rather than utoipa. |
