# Type Alias: AgentApiKey

> **AgentApiKey** = \{ `key?`: `null` \| [`SavedAgentApiKey`](SavedAgentApiKey.md); `planAllows`: `boolean`; \}

An agent's API key, and whether its turns can run on it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-key"></a> `key?` | `null` \| [`SavedAgentApiKey`](SavedAgentApiKey.md) | - |
| <a id="property-planallows"></a> `planAllows` | `boolean` | Whether the agent owner's plan includes API keys. A key saved before a downgrade is still listed, and removable, but unused. |
