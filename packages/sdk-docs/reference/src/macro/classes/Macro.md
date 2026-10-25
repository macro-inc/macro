# Class: Macro\<T\>

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-t"></a> `T` *extends* [`MacroOpts`](../../config/interfaces/MacroOpts.md) | [`MacroOpts`](../../config/interfaces/MacroOpts.md) |

## Constructors

### Constructor

> **new Macro**\<`T`\>(`opts`): `Macro`\<`T`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | `T` |

#### Returns

`Macro`\<`T`\>

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-_client"></a> `_client` | `readonly` | `MacroClient` | Direct access to the underlying hey-api service clients. |
| <a id="property-agents"></a> `agents` | `readonly` | [`AgentNamespace`](../../entities/agents/namespace/classes/AgentNamespace.md) | agents resources and operations. |
| <a id="property-agentsessions"></a> `agentSessions` | `readonly` | [`AgentSessionNamespace`](../../entities/agent-sessions/namespace/classes/AgentSessionNamespace.md) | - |
| <a id="property-ai"></a> `ai` | `readonly` | [`AiNamespace`](../../entities/ai/namespace/classes/AiNamespace.md) | - |
| <a id="property-apikeys"></a> `apiKeys` | `readonly` | [`ApiKeyNamespace`](../../entities/api-keys/namespace/classes/ApiKeyNamespace.md) | apiKeys resources and operations. |
| <a id="property-bots"></a> `bots` | `readonly` | [`BotsNamespace`](../../entities/bots/namespace/classes/BotsNamespace.md) | - |
| <a id="property-calendar"></a> `calendar` | `readonly` | [`CalendarNamespace`](../../entities/calendar/namespace/classes/CalendarNamespace.md) | - |
| <a id="property-calls"></a> `calls` | `readonly` | [`CallRecordNamespace`](../../entities/calls/namespace/classes/CallRecordNamespace.md) | - |
| <a id="property-channels"></a> `channels` | `readonly` | [`ChannelNamespace`](../../entities/channels/namespace/classes/ChannelNamespace.md) | - |
| <a id="property-chats"></a> `chats` | `readonly` | [`ChatNamespace`](../../entities/chats/namespace/classes/ChatNamespace.md) | - |
| <a id="property-crm"></a> `crm` | `readonly` | [`CrmNamespace`](../../entities/crm/namespace/classes/CrmNamespace.md) | - |
| <a id="property-databases"></a> `databases` | `readonly` | [`DatabaseNamespace`](../../entities/databases/namespace/classes/DatabaseNamespace.md) | - |
| <a id="property-documents"></a> `documents` | `readonly` | [`DocumentNamespace`](../../entities/documents/namespace/classes/DocumentNamespace.md) | - |
| <a id="property-email"></a> `email` | `readonly` | [`EmailNamespace`](../../entities/email/namespace/classes/EmailNamespace.md) | - |
| <a id="property-entitymentions"></a> `entityMentions` | `readonly` | [`EntityMentionNamespace`](../../entities/entity-mentions/namespace/classes/EntityMentionNamespace.md) | entityMentions resources and operations. |
| <a id="property-events"></a> `events` | `readonly` | [`MacroEvents`](../../events/receiver/classes/MacroEvents.md) | - |
| <a id="property-favorites"></a> `favorites` | `readonly` | [`FavoritesNamespace`](../../entities/favorites/namespace/classes/FavoritesNamespace.md) | - |
| <a id="property-foreignentities"></a> `foreignEntities` | `readonly` | [`ForeignEntityNamespace`](../../entities/foreign/namespace/classes/ForeignEntityNamespace.md) | - |
| <a id="property-forms"></a> `forms` | `readonly` | [`FormNamespace`](../../entities/forms/namespace/classes/FormNamespace.md) | Build forms and submit answers without granting respondents database access. |
| <a id="property-githubpullrequests"></a> `githubPullRequests` | `readonly` | [`GithubPullRequestNamespace`](../../entities/github-pull-requests/namespace/classes/GithubPullRequestNamespace.md) | githubPullRequests resources and operations. |
| <a id="property-harnesses"></a> `harnesses` | `readonly` | [`HarnessNamespace`](../../entities/harnesses/namespace/classes/HarnessNamespace.md) | harnesses resources and operations. |
| <a id="property-initiatives"></a> `initiatives` | `readonly` | [`InitiativeNamespace`](../../entities/initiatives/namespace/classes/InitiativeNamespace.md) | initiatives resources and operations. |
| <a id="property-meetings"></a> `meetings` | `readonly` | [`MeetingNamespace`](../../entities/meetings/namespace/classes/MeetingNamespace.md) | meetings resources and operations. |
| <a id="property-notifications"></a> `notifications` | `readonly` | [`NotificationNamespace`](../../entities/notifications/namespace/classes/NotificationNamespace.md) | - |
| <a id="property-pins"></a> `pins` | `readonly` | [`PinsNamespace`](../../entities/pins/namespace/classes/PinsNamespace.md) | - |
| <a id="property-projects"></a> `projects` | `readonly` | [`ProjectNamespace`](../../entities/projects/namespace/classes/ProjectNamespace.md) | - |
| <a id="property-properties"></a> `properties` | `readonly` | [`PropertiesNamespace`](../../entities/properties/namespace/classes/PropertiesNamespace.md) | - |
| <a id="property-routines"></a> `routines` | `readonly` | [`RoutineNamespace`](../../entities/routines/namespace/classes/RoutineNamespace.md) | routines resources and operations. |
| <a id="property-tasks"></a> `tasks` | `readonly` | [`TaskNamespace`](../../entities/tasks/namespace/classes/TaskNamespace.md) | - |
| <a id="property-teams"></a> `teams` | `readonly` | [`TeamNamespace`](../../entities/teams/namespace/classes/TeamNamespace.md) | - |
| <a id="property-unfurls"></a> `unfurls` | `readonly` | [`UnfurlNamespace`](../../entities/unfurls/namespace/classes/UnfurlNamespace.md) | unfurls resources and operations. |
| <a id="property-users"></a> `users` | `readonly` | [`UserNamespace`](../../entities/users/namespace/classes/UserNamespace.md) | - |
| <a id="property-webappurl"></a> `webAppUrl` | `readonly` | `string` | Base URL of the Macro web app, used to build entity URLs. |
| <a id="property-webhooks"></a> `webhooks` | `readonly` | [`WebhooksNamespace`](../../entities/webhooks/namespace/classes/WebhooksNamespace.md) | - |
| <a id="property-workspace"></a> `workspace` | `readonly` | [`WorkspaceNamespace`](../../entities/workspace/namespace/classes/WorkspaceNamespace.md) | Browse workspace activity with type, task, time, tag and inbox filters. |

## Methods

### myPrincipalId()

> **myPrincipalId**(): `Promise`\<`string`\>

The authenticated caller's mentionable principal — `bot|<uuid>` for bot
auth, `macro|<email>` for user auth — fetched once and cached.

#### Returns

`Promise`\<`string`\>

***

### requestedAs()

> **requestedAs**(`user`): `Macro`\<`T`\>

Clone of this SDK acting on behalf of `user` (sent as
`x-macro-bot-for-macro-user-id`). Bot auth only — throws for user auth,
since a user token always acts as its own user.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `user` | [`User`](../../entities/users/user/classes/User.md) |

#### Returns

`Macro`\<`T`\>
