# Type Alias: TeamAgent

> **TeamAgent** = \{ `brainBotId?`: `string` \| `null`; `brainSessionId?`: `string` \| `null`; `createdAt`: `string`; `createdBy?`: `string` \| `null`; `email`: `string`; `harnessId?`: `string` \| `null`; `jobDescription`: `string`; `name`: `string`; `personality`: `string`; `teamId`: `string`; `userId`: `string`; \}

A team agent: an AI teammate with its own Macro account on a team.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-brainbotid"></a> `brainBotId?` | `string` \| `null` | The Macro agent (bot) bound to the brain's runtime. |
| <a id="property-brainsessionid"></a> `brainSessionId?` | `string` \| `null` | The brain's first agent session, where it set itself up. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the agent was created. |
| <a id="property-createdby"></a> `createdBy?` | `string` \| `null` | Admin who created the agent; it takes operating instructions from them. |
| <a id="property-email"></a> `email` | `string` | The agent's email address. |
| <a id="property-harnessid"></a> `harnessId?` | `string` \| `null` | The macrod runtime the agent's brain runs on. |
| <a id="property-jobdescription"></a> `jobDescription` | `string` | What the agent is responsible for. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-personality"></a> `personality` | `string` | How the agent behaves and talks. |
| <a id="property-teamid"></a> `teamId` | `string` | Team the agent belongs to. |
| <a id="property-userid"></a> `userId` | `string` | The agent's Macro user id (`macro\|<email>`). |
