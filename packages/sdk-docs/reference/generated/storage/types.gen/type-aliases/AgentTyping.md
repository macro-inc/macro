# Type Alias: AgentTyping

> **AgentTyping** = \{ `phase`: [`AgentTypingPhase`](AgentTypingPhase.md); `session_id`: `string`; \}

An agent session typing through its bot.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-phase"></a> `phase` | [`AgentTypingPhase`](AgentTypingPhase.md) | What the agent is doing. Deliberately coarse: a typing event reaches everyone in the conversation, and which tool runs on what is for viewers who can read the session itself. |
| <a id="property-session_id"></a> `session_id` | `string` | The session whose turn the bot is speaking for. |
