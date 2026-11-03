# Type Alias: CreateTeamAgent

> **CreateTeamAgent** = \{ `avatarUrl?`: `string` \| `null`; `harnessId`: `string`; `jobDescription`: `string`; `model`: `string`; `name`: `string`; `personality`: `string`; \}

Input for creating a team agent.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-avatarurl"></a> `avatarUrl?` | `string` \| `null` | Profile picture URL (a static file the caller uploaded). |
| <a id="property-harnessid"></a> `harnessId` | `string` | The team macrod runtime to run the agent's brain on. |
| <a id="property-jobdescription"></a> `jobDescription` | `string` | What the agent is responsible for. |
| <a id="property-model"></a> `model` | `string` | The runtime's model for the brain's sessions. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-personality"></a> `personality` | `string` | How the agent behaves and talks. |
