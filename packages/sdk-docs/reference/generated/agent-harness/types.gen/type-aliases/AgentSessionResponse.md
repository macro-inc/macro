# Type Alias: AgentSessionResponse

> **AgentSessionResponse** = \{ `acpSessionId?`: `string` \| `null`; `botId`: `string`; `canEdit`: `boolean`; `createdAt`: `string`; `external?`: `null` \| [`ExternalSessionResponse`](ExternalSessionResponse.md); `harness`: `string`; `id`: `string`; `instructions?`: `string` \| `null`; `isArchived`: `boolean`; `model`: `string`; `modifiedAt`: `string`; `name`: `string`; `originatingMessageId?`: `string` \| `null`; `ownerId`: `string`; `pullRequestUrl?`: `string` \| `null`; `repoUrl?`: `string` \| `null`; `sandboxSize`: [`SandboxSize`](SandboxSize.md); `status`: [`SessionStatusDto`](SessionStatusDto.md); `taskId?`: `string` \| `null`; `threadChannelId?`: `string` \| `null`; `threadId?`: `string` \| `null`; `threadParent?`: `null` \| [`MessageParent`](MessageParent.md); `workspace`: `string`; \}

Response body describing an agent session.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-acpsessionid"></a> `acpSessionId?` | `string` \| `null` | The ACP session id, if one exists. |
| <a id="property-botid"></a> `botId` | `string` | The bot running the agent. |
| <a id="property-canedit"></a> `canEdit` | `boolean` | Whether the caller may drive the session - prompt it, answer its questions, stop it - rather than only watch. Edit access; the creator owns the session, so a create response always says so. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the session was created. |
| <a id="property-external"></a> `external?` | `null` \| [`ExternalSessionResponse`](ExternalSessionResponse.md) | - |
| <a id="property-harness"></a> `harness` | `string` | Harness slug. |
| <a id="property-id"></a> `id` | `string` | The session id. |
| <a id="property-instructions"></a> `instructions?` | `string` \| `null` | Instructions the session's runtime works under, when any were stated at creation. Absent otherwise, so existing payloads are unchanged. |
| <a id="property-isarchived"></a> `isArchived` | `boolean` | Whether the session is archived and read-only. |
| <a id="property-model"></a> `model` | `string` | Model slug. |
| <a id="property-modifiedat"></a> `modifiedAt` | `string` | When the session was last modified. |
| <a id="property-name"></a> `name` | `string` | User-facing session name. |
| <a id="property-originatingmessageid"></a> `originatingMessageId?` | `string` \| `null` | The exact message that invoked the bot, if any. |
| <a id="property-ownerid"></a> `ownerId` | `string` | The user who created and owns the session. |
| <a id="property-pullrequesturl"></a> `pullRequestUrl?` | `string` \| `null` | The session's linked pull request. |
| <a id="property-repourl"></a> `repoUrl?` | `string` \| `null` | The repository the session works with, when one was stated. |
| <a id="property-sandboxsize"></a> `sandboxSize` | [`SandboxSize`](SandboxSize.md) | Compute tier of the managed sandbox. |
| <a id="property-status"></a> `status` | [`SessionStatusDto`](SessionStatusDto.md) | The session's status. |
| <a id="property-taskid"></a> `taskId?` | `string` \| `null` | The Macro task the session was linked to. |
| <a id="property-threadchannelid"></a> `threadChannelId?` | `string` \| `null` | The channel `thread_id` lives in, when the session was spawned from a channel thread. Derived from `thread_parent`. |
| <a id="property-threadid"></a> `threadId?` | `string` \| `null` | The root message of the thread the session was created from, if any. |
| <a id="property-threadparent"></a> `threadParent?` | `null` \| [`MessageParent`](MessageParent.md) | - |
| <a id="property-workspace"></a> `workspace` | `string` | The directory the session's harness runs in on its runtime. |
