# Type Alias: AgentSetupResponse

> **AgentSetupResponse** = \{ `api_key`: `string`; `team_join_failed`: `boolean`; \}

What an agent needs to start using the SDK.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-api_key"></a> `api_key` | `string` | The agent's API key. Shown only here; repeating setup revokes it. |
| <a id="property-team_join_failed"></a> `team_join_failed` | `boolean` | Whether joining the inviting team failed. The invite stays pending, and repeating setup tries again. |
