# Abstract Class: MacroEntity\<Detail\>

Base for entity handles: a free-to-construct `(client, id)` pair whose
detail record loads lazily on first field access and is dropped after any
mutation. Subclasses implement fetch and build their surface from
field and mutate.

A handle is not its record. `id` is a plain property; record-backed fields
are async functions, so read them with `await handle.name()`, not
`handle.name`. Record keys the class does not expose as fields read as
`undefined` on the handle rather than throwing. The cached record sits in a
protected `detail` cache: in plain JavaScript `handle.detail` exists, but it
is the cache object, not the record, so `handle.detail.someField` is
`undefined` too.

A seeded handle was built from a record the SDK already received, such as a
list page, and reads fields without a request. Handles from `byId` start
empty and fetch on the first field read; some list and search methods also
return empty handles. Any mutation through the handle drops the cache.

## Extended by

- [`AgentSession`](../../agent-sessions/agent-session/classes/AgentSession.md)
- [`CodeExecution`](../../agent-sessions/code-execution/classes/CodeExecution.md)
- [`SessionReview`](../../agent-sessions/review/classes/SessionReview.md)
- [`Agent`](../../agents/agent/classes/Agent.md)
- [`UserApiKey`](../../api-keys/api-key/classes/UserApiKey.md)
- [`Calendar`](../../calendar/calendar/classes/Calendar.md)
- [`CalendarEvent`](../../calendar/event/classes/CalendarEvent.md)
- [`CalendarNote`](../../calendar/note/classes/CalendarNote.md)
- [`CallMessage`](../../calls/message/classes/CallMessage.md)
- [`ChatMessage`](../../chats/generation/classes/ChatMessage.md)
- [`CrmComment`](../../crm/comment/classes/CrmComment.md)
- [`CrmPipeline`](../../crm/pipeline/classes/CrmPipeline.md)
- [`PipelineTable`](../../crm/pipeline/classes/PipelineTable.md)
- [`PipelineRow`](../../crm/pipeline/classes/PipelineRow.md)
- [`PipelineColumn`](../../crm/pipeline/classes/PipelineColumn.md)
- [`Database`](../../databases/database/classes/Database.md)
- [`DocumentAnchor`](../../documents/anchor/classes/DocumentAnchor.md)
- [`Comment`](../../documents/comment/classes/Comment.md)
- [`EmailAttachment`](../../email/attachment/classes/EmailAttachment.md)
- [`EmailFilter`](../../email/filter/classes/EmailFilter.md)
- [`Label`](../../email/label/classes/Label.md)
- [`Link`](../../email/link/classes/Link.md)
- [`EmailMessage`](../../email/message/classes/EmailMessage.md)
- [`FavoritableEntity`](FavoritableEntity.md)
- [`ExternalChatMessage`](../../external-chat/message/classes/ExternalChatMessage.md)
- [`ExternalChatSend`](../../external-chat/send/classes/ExternalChatSend.md)
- [`Form`](../../forms/form/classes/Form.md)
- [`GithubPullRequest`](../../github-pull-requests/pull-request/classes/GithubPullRequest.md)
- [`Harness`](../../harnesses/harness/classes/Harness.md)
- [`HarnessPairing`](../../harnesses/pairing/classes/HarnessPairing.md)
- [`Initiative`](../../initiatives/initiative/classes/Initiative.md)
- [`Meeting`](../../meetings/meeting/classes/Meeting.md)
- [`MessageThread`](../../messages/thread/classes/MessageThread.md)
- [`Notification`](../../notifications/notification/classes/Notification.md)
- [`Routine`](../../routines/routine/classes/Routine.md)
- [`AccessRequest`](../../sharing/access/classes/AccessRequest.md)
- [`Team`](../../teams/team/classes/Team.md)
- [`Webhook`](../../webhooks/webhook/classes/Webhook.md)
- [`WhatsAppAccount`](../../whatsapp/account/classes/WhatsAppAccount.md)
- [`WhatsAppChat`](../../whatsapp/chat/classes/WhatsAppChat.md)

## Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-detail"></a> `Detail` |

## Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `public readonly` | `string` |

## Methods

### toJSON()

> **toJSON**(): \{ `detail?`: `Detail`; `id`: `string`; \}

Serialize as `{ id, detail }`, where `detail` is the cached record, or as
`{ id }` when nothing is cached yet. Never fetches. This is what
`JSON.stringify(handle)` uses; it is a snapshot for logging and transport,
not a typed read API, and the record's shape follows the API response
that seeded it.

#### Returns

\{ `detail?`: `Detail`; `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | `Detail` |
| `id` | `string` |
