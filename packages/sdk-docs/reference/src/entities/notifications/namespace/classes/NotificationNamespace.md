# Class: NotificationNamespace

## Constructors

### Constructor

> **new NotificationNamespace**(`client`): `NotificationNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`NotificationNamespace`

## Methods

### byId()

> **byId**(`id`): [`Notification`](../../notification/classes/Notification.md)

A handle to a notification by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Notification`](../../notification/classes/Notification.md)

***

### delete()

> **delete**(`ids`): `Promise`\<`void`\>

Delete a batch of notifications.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ids` | `string`[] |

#### Returns

`Promise`\<`void`\>

***

### disableType()

> **disableType**(`type`): `Promise`\<`void`\>

Disable delivery of a notification type.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `type` | `"reminder"` \| `"channel_mention"` \| `"document_mention"` \| `"mentioned_in_document_comment"` \| `"replied_to_document_comment_thread"` \| `"commented_on_document"` \| `"entity_access_requested"` \| `"entity_access_granted"` \| `"initiative_discussion"` \| `"crm_discussion"` \| `"channel_invite"` \| `"channel_message_send"` \| `"channel_message_reply"` \| `"call_started"` \| `"new_email"` \| `"inbox_reauth_required"` \| `"invite_to_team"` \| `"task_assigned"` \| `"calendar_event_reminder"` \| `"ai_response"` \| `"github_pr_status_changed"` \| `"github_pr_check_run"` \| `"github_review_requested"` \| `"github_pr_comment"` \| `"github_pr_mention"` \| `"github_pr_review"` \| `"agent_session_settled"` \| `"agent_session_waiting_for_input"` \| `"agent_session_mentioned"` \| `"channel_message_reaction"` \| `"calendar_event_join_request"` |

#### Returns

`Promise`\<`void`\>

***

### enableType()

> **enableType**(`type`): `Promise`\<`void`\>

Re-enable delivery of a notification type.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `type` | `"reminder"` \| `"channel_mention"` \| `"document_mention"` \| `"mentioned_in_document_comment"` \| `"replied_to_document_comment_thread"` \| `"commented_on_document"` \| `"entity_access_requested"` \| `"entity_access_granted"` \| `"initiative_discussion"` \| `"crm_discussion"` \| `"channel_invite"` \| `"channel_message_send"` \| `"channel_message_reply"` \| `"call_started"` \| `"new_email"` \| `"inbox_reauth_required"` \| `"invite_to_team"` \| `"task_assigned"` \| `"calendar_event_reminder"` \| `"ai_response"` \| `"github_pr_status_changed"` \| `"github_pr_check_run"` \| `"github_review_requested"` \| `"github_pr_comment"` \| `"github_pr_mention"` \| `"github_pr_review"` \| `"agent_session_settled"` \| `"agent_session_waiting_for_input"` \| `"agent_session_mentioned"` \| `"channel_message_reaction"` \| `"calendar_event_join_request"` |

#### Returns

`Promise`\<`void`\>

***

### list()

> **list**(`opts?`): `AsyncGenerator`\<[`Notification`](../../notification/classes/Notification.md)\>

The viewer's notification feed, most recent first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `pageSize?`: `number`; \} |
| `opts.pageSize?` | `number` |

#### Returns

`AsyncGenerator`\<[`Notification`](../../notification/classes/Notification.md)\>

***

### markDone()

> **markDone**(`ids`): `Promise`\<`void`\>

Mark a batch of notifications as done.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ids` | `string`[] |

#### Returns

`Promise`\<`void`\>

***

### markSeen()

> **markSeen**(`ids`): `Promise`\<`void`\>

Mark a batch of notifications as seen.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ids` | `string`[] |

#### Returns

`Promise`\<`void`\>

***

### preferences()

> **preferences**(): `Promise`\<[`GetNotificationTypePreferencesResponse`](../../../../../generated/notification/types.gen/type-aliases/GetNotificationTypePreferencesResponse.md)\>

The viewer's notification type preferences (disabled types).

#### Returns

`Promise`\<[`GetNotificationTypePreferencesResponse`](../../../../../generated/notification/types.gen/type-aliases/GetNotificationTypePreferencesResponse.md)\>
