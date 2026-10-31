# Type Alias: SoupAgentSessionSoupPropertiesField

> **SoupAgentSessionSoupPropertiesField** = \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `botId`: `string`; `createdAt`: `string`; `harness`: `string`; `id`: `string`; `isArchived`: `boolean`; `name`: `string`; `ownerId`: `string`; `pullRequestId?`: `string` \| `null`; `pullRequestState?`: `null` \| [`AgentPullRequestState`](AgentPullRequestState.md); `pullRequestUrl?`: `string` \| `null`; `repoBranch?`: `string` \| `null`; `repoUrl?`: `string` \| `null`; `source?`: [`AgentSessionSource`](AgentSessionSource.md); `status`: `string`; `threadId?`: `string` \| `null`; `turnState?`: `string` \| `null`; `updatedAt`: `string`; `viewedAt?`: `string` \| `null`; `visibility?`: [`AgentSessionVisibility`](AgentSessionVisibility.md); `workingBranch?`: `string` \| `null`; \}

An agent session as displayed in Soup.

Includes the persisted runtime and repository metadata needed to render
coding and non-coding sessions without fetching each session separately.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `botId` | `string` | The bot running this session |
| `createdAt` | `string` | The time the session was created |
| `harness` | `string` | The runtime snapshotted when the session was created. |
| `id` | `string` | The agent session uuid |
| `isArchived` | `boolean` | Whether the session is archived and read-only. |
| `name` | `string` | The user-facing name of the session |
| `ownerId` | `string` | Who the session belongs to |
| `pullRequestId?` | `string` \| `null` | The linked pull request's Macro entity, when visible to the viewer. |
| `pullRequestState?` | `null` \| [`AgentPullRequestState`](AgentPullRequestState.md) | - |
| `pullRequestUrl?` | `string` \| `null` | The persisted pull request associated with the session. |
| `repoBranch?` | `string` \| `null` | The starting branch selected for this session, not its current branch. |
| `repoUrl?` | `string` \| `null` | The repository the session works with, when one was selected. |
| `source?` | [`AgentSessionSource`](AgentSessionSource.md) | Who started the session |
| `status` | `string` | The session's last known status. `no_messages` until the first system event arrives, `disconnected` if the connection dropped without a clean close, otherwise the wire name of the most recent system event (for example `session/end`). |
| `threadId?` | `string` \| `null` | The channel thread the session was opened from, when any |
| `turnState?` | `string` \| `null` | Last persisted fold turn state. Absent until an older session next runs. |
| `updatedAt` | `string` | The time the session was last modified |
| `viewedAt?` | `string` \| `null` | The time the session was last viewed by the requesting user |
| `visibility?` | [`AgentSessionVisibility`](AgentSessionVisibility.md) | Where the session is shown |
| `workingBranch?` | `string` \| `null` | Last captured working branch, when the runtime has reported one. |
