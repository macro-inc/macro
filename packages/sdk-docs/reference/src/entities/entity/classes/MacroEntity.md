# Abstract Class: MacroEntity\<Detail\>

Base for entity handles: a free-to-construct `(client, id)` pair whose
detail record loads lazily on first field access and is dropped after any
mutation. Subclasses implement fetch and build their surface from
field and mutate.

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

#### Returns

\{ `detail?`: `Detail`; `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | `Detail` |
| `id` | `string` |
