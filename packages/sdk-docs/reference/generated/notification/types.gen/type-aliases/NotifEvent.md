# Type Alias: NotifEvent

> **NotifEvent** = \{ `content`: [`ChannelMentionMetadata`](ChannelMentionMetadata.md); `tag`: `"channel_mention"`; \} \| \{ `content`: [`DocumentMentionMetadata`](DocumentMentionMetadata.md); `tag`: `"document_mention"`; \} \| \{ `content`: [`MentionedInDocumentCommentMetadata`](MentionedInDocumentCommentMetadata.md); `tag`: `"mentioned_in_document_comment"`; \} \| \{ `content`: [`RepliedToDocumentCommentThreadMetadata`](RepliedToDocumentCommentThreadMetadata.md); `tag`: `"replied_to_document_comment_thread"`; \} \| \{ `content`: [`CommentedOnDocumentMetadata`](CommentedOnDocumentMetadata.md); `tag`: `"commented_on_document"`; \} \| \{ `content`: [`EntityAccessRequestedMetadata`](EntityAccessRequestedMetadata.md); `tag`: `"entity_access_requested"`; \} \| \{ `content`: [`EntityAccessGrantedMetadata`](EntityAccessGrantedMetadata.md); `tag`: `"entity_access_granted"`; \} \| \{ `content`: [`InitiativeDiscussionMetadata`](InitiativeDiscussionMetadata.md); `tag`: `"initiative_discussion"`; \} \| \{ `content`: [`CrmDiscussionMetadata`](CrmDiscussionMetadata.md); `tag`: `"crm_discussion"`; \} \| \{ `content`: [`ChannelInviteMetadata`](ChannelInviteMetadata.md); `tag`: `"channel_invite"`; \} \| \{ `content`: [`ChannelMessageSendMetadata`](ChannelMessageSendMetadata.md); `tag`: `"channel_message_send"`; \} \| \{ `content`: [`ChannelReplyMetadata`](ChannelReplyMetadata.md); `tag`: `"channel_message_reply"`; \} \| \{ `content`: [`CallStartedMetadata`](CallStartedMetadata.md); `tag`: `"call_started"`; \} \| \{ `content`: [`NewEmailMetadata`](NewEmailMetadata.md); `tag`: `"new_email"`; \} \| \{ `content`: [`InboxReauthRequiredMetadata`](InboxReauthRequiredMetadata.md); `tag`: `"inbox_reauth_required"`; \} \| \{ `content`: [`InviteToTeamMetadata`](InviteToTeamMetadata.md); `tag`: `"invite_to_team"`; \} \| \{ `content`: [`TaskAssignedMetadata`](TaskAssignedMetadata.md); `tag`: `"task_assigned"`; \} \| \{ `content`: [`ReminderMetadata`](ReminderMetadata.md); `tag`: `"reminder"`; \} \| \{ `content`: [`CalendarEventReminderMetadata`](CalendarEventReminderMetadata.md); `tag`: `"calendar_event_reminder"`; \} \| \{ `content`: [`AiResponseMetadata`](AiResponseMetadata.md); `tag`: `"ai_response"`; \} \| \{ `content`: [`GithubPrStatusChanged`](GithubPrStatusChanged.md); `tag`: `"github_pr_status_changed"`; \} \| \{ `content`: [`GithubPrCheckRun`](GithubPrCheckRun.md); `tag`: `"github_pr_check_run"`; \} \| \{ `content`: [`GithubReviewRequested`](GithubReviewRequested.md); `tag`: `"github_review_requested"`; \} \| \{ `content`: [`GithubPrComment`](GithubPrComment.md); `tag`: `"github_pr_comment"`; \} \| \{ `content`: [`GithubPrMention`](GithubPrMention.md); `tag`: `"github_pr_mention"`; \} \| \{ `content`: [`GithubPrReview`](GithubPrReview.md); `tag`: `"github_pr_review"`; \} \| \{ `content`: [`AgentSessionSettledMetadata`](AgentSessionSettledMetadata.md); `tag`: `"agent_session_settled"`; \} \| \{ `content`: [`AgentSessionWaitingForInputMetadata`](AgentSessionWaitingForInputMetadata.md); `tag`: `"agent_session_waiting_for_input"`; \} \| \{ `content`: [`AgentSessionMentionedMetadata`](AgentSessionMentionedMetadata.md); `tag`: `"agent_session_mentioned"`; \} \| \{ `content`: [`ChannelMessageReactionMetadata`](ChannelMessageReactionMetadata.md); `tag`: `"channel_message_reaction"`; \}

Mirrors [`model_notifications::NotificationEvent`] but uses `tag` / `content`
as the serde adjacently-tagged field names so it can be deserialized from the
shape produced by [`UserNotificationRow::into_tagged`] +
[`UserNotificationRow::into_json`].

Only includes variants whose metadata types implement the `Notification` trait.

## Union Members

### Type Literal

\{ `content`: [`ChannelMentionMetadata`](ChannelMentionMetadata.md); `tag`: `"channel_mention"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`ChannelMentionMetadata`](ChannelMentionMetadata.md) | Someone mentioned you in a channel. |
| `tag` | `"channel_mention"` | - |

***

### Type Literal

\{ `content`: [`DocumentMentionMetadata`](DocumentMentionMetadata.md); `tag`: `"document_mention"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`DocumentMentionMetadata`](DocumentMentionMetadata.md) | Someone mentioned a document in a channel. |
| `tag` | `"document_mention"` | - |

***

### Type Literal

\{ `content`: [`MentionedInDocumentCommentMetadata`](MentionedInDocumentCommentMetadata.md); `tag`: `"mentioned_in_document_comment"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`MentionedInDocumentCommentMetadata`](MentionedInDocumentCommentMetadata.md) | User was mentioned in a comment in a document |
| `tag` | `"mentioned_in_document_comment"` | - |

***

### Type Literal

\{ `content`: [`RepliedToDocumentCommentThreadMetadata`](RepliedToDocumentCommentThreadMetadata.md); `tag`: `"replied_to_document_comment_thread"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`RepliedToDocumentCommentThreadMetadata`](RepliedToDocumentCommentThreadMetadata.md) | Someone replied to a document comment thread the user participated in. |
| `tag` | `"replied_to_document_comment_thread"` | - |

***

### Type Literal

\{ `content`: [`CommentedOnDocumentMetadata`](CommentedOnDocumentMetadata.md); `tag`: `"commented_on_document"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`CommentedOnDocumentMetadata`](CommentedOnDocumentMetadata.md) | Someone commented on a document the user owns. |
| `tag` | `"commented_on_document"` | - |

***

### Type Literal

\{ `content`: [`EntityAccessRequestedMetadata`](EntityAccessRequestedMetadata.md); `tag`: `"entity_access_requested"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`EntityAccessRequestedMetadata`](EntityAccessRequestedMetadata.md) | Someone requested more access to a shared entity. |
| `tag` | `"entity_access_requested"` | - |

***

### Type Literal

\{ `content`: [`EntityAccessGrantedMetadata`](EntityAccessGrantedMetadata.md); `tag`: `"entity_access_granted"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`EntityAccessGrantedMetadata`](EntityAccessGrantedMetadata.md) | An owner granted requested access. |
| `tag` | `"entity_access_granted"` | - |

***

### Type Literal

\{ `content`: [`InitiativeDiscussionMetadata`](InitiativeDiscussionMetadata.md); `tag`: `"initiative_discussion"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`InitiativeDiscussionMetadata`](InitiativeDiscussionMetadata.md) | Someone commented, replied, or mentioned the recipient on a project. |
| `tag` | `"initiative_discussion"` | - |

***

### Type Literal

\{ `content`: [`CrmDiscussionMetadata`](CrmDiscussionMetadata.md); `tag`: `"crm_discussion"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`CrmDiscussionMetadata`](CrmDiscussionMetadata.md) | Someone commented, replied, or mentioned the recipient on a CRM company or contact. |
| `tag` | `"crm_discussion"` | - |

***

### Type Literal

\{ `content`: [`ChannelInviteMetadata`](ChannelInviteMetadata.md); `tag`: `"channel_invite"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`ChannelInviteMetadata`](ChannelInviteMetadata.md) | The user was invited to a channel. |
| `tag` | `"channel_invite"` | - |

***

### Type Literal

\{ `content`: [`ChannelMessageSendMetadata`](ChannelMessageSendMetadata.md); `tag`: `"channel_message_send"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`ChannelMessageSendMetadata`](ChannelMessageSendMetadata.md) | A user sent a message in a channel. |
| `tag` | `"channel_message_send"` | - |

***

### Type Literal

\{ `content`: [`ChannelReplyMetadata`](ChannelReplyMetadata.md); `tag`: `"channel_message_reply"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`ChannelReplyMetadata`](ChannelReplyMetadata.md) | Someone replied to a thread in a channel that the user is part of. |
| `tag` | `"channel_message_reply"` | - |

***

### Type Literal

\{ `content`: [`CallStartedMetadata`](CallStartedMetadata.md); `tag`: `"call_started"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`CallStartedMetadata`](CallStartedMetadata.md) | A call has started in a channel the user is a member of. The `call-started` alias keeps rows persisted before the type name was normalized to snake_case (`call_started`) deserializable. |
| `tag` | `"call_started"` | - |

***

### Type Literal

\{ `content`: [`NewEmailMetadata`](NewEmailMetadata.md); `tag`: `"new_email"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`NewEmailMetadata`](NewEmailMetadata.md) | A new email has been sent to the user. |
| `tag` | `"new_email"` | - |

***

### Type Literal

\{ `content`: [`InboxReauthRequiredMetadata`](InboxReauthRequiredMetadata.md); `tag`: `"inbox_reauth_required"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`InboxReauthRequiredMetadata`](InboxReauthRequiredMetadata.md) | A linked inbox's grant died and must be reconnected. |
| `tag` | `"inbox_reauth_required"` | - |

***

### Type Literal

\{ `content`: [`InviteToTeamMetadata`](InviteToTeamMetadata.md); `tag`: `"invite_to_team"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`InviteToTeamMetadata`](InviteToTeamMetadata.md) | A user was invited to a team. |
| `tag` | `"invite_to_team"` | - |

***

### Type Literal

\{ `content`: [`TaskAssignedMetadata`](TaskAssignedMetadata.md); `tag`: `"task_assigned"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`TaskAssignedMetadata`](TaskAssignedMetadata.md) | A user was assigned to a task. |
| `tag` | `"task_assigned"` | - |

***

### Type Literal

\{ `content`: [`ReminderMetadata`](ReminderMetadata.md); `tag`: `"reminder"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`ReminderMetadata`](ReminderMetadata.md) | A reminder the user set for themselves came due. |
| `tag` | `"reminder"` | - |

***

### Type Literal

\{ `content`: [`CalendarEventReminderMetadata`](CalendarEventReminderMetadata.md); `tag`: `"calendar_event_reminder"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`CalendarEventReminderMetadata`](CalendarEventReminderMetadata.md) | A calendar event alarm came due. |
| `tag` | `"calendar_event_reminder"` | - |

***

### Type Literal

\{ `content`: [`AiResponseMetadata`](AiResponseMetadata.md); `tag`: `"ai_response"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`AiResponseMetadata`](AiResponseMetadata.md) | An AI assistant responded to a chat. |
| `tag` | `"ai_response"` | - |

***

### Type Literal

\{ `content`: [`GithubPrStatusChanged`](GithubPrStatusChanged.md); `tag`: `"github_pr_status_changed"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`GithubPrStatusChanged`](GithubPrStatusChanged.md) | A GitHub pull request changed lifecycle state. The `github_pr_event` alias keeps rows and queue messages persisted before the rename deserializable. |
| `tag` | `"github_pr_status_changed"` | - |

***

### Type Literal

\{ `content`: [`GithubPrCheckRun`](GithubPrCheckRun.md); `tag`: `"github_pr_check_run"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`GithubPrCheckRun`](GithubPrCheckRun.md) | A GitHub pull request check run completed. |
| `tag` | `"github_pr_check_run"` | - |

***

### Type Literal

\{ `content`: [`GithubReviewRequested`](GithubReviewRequested.md); `tag`: `"github_review_requested"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`GithubReviewRequested`](GithubReviewRequested.md) | The user's review was requested on a GitHub pull request. |
| `tag` | `"github_review_requested"` | - |

***

### Type Literal

\{ `content`: [`GithubPrComment`](GithubPrComment.md); `tag`: `"github_pr_comment"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`GithubPrComment`](GithubPrComment.md) | A GitHub pull request was commented on. |
| `tag` | `"github_pr_comment"` | - |

***

### Type Literal

\{ `content`: [`GithubPrMention`](GithubPrMention.md); `tag`: `"github_pr_mention"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`GithubPrMention`](GithubPrMention.md) | The user was mentioned on a GitHub pull request. |
| `tag` | `"github_pr_mention"` | - |

***

### Type Literal

\{ `content`: [`GithubPrReview`](GithubPrReview.md); `tag`: `"github_pr_review"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`GithubPrReview`](GithubPrReview.md) | A review was submitted on the user's GitHub pull request. |
| `tag` | `"github_pr_review"` | - |

***

### Type Literal

\{ `content`: [`AgentSessionSettledMetadata`](AgentSessionSettledMetadata.md); `tag`: `"agent_session_settled"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`AgentSessionSettledMetadata`](AgentSessionSettledMetadata.md) | An agent finished a turn with nothing queued behind it. |
| `tag` | `"agent_session_settled"` | - |

***

### Type Literal

\{ `content`: [`AgentSessionWaitingForInputMetadata`](AgentSessionWaitingForInputMetadata.md); `tag`: `"agent_session_waiting_for_input"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`AgentSessionWaitingForInputMetadata`](AgentSessionWaitingForInputMetadata.md) | An agent is blocked on a question for the session's owner. |
| `tag` | `"agent_session_waiting_for_input"` | - |

***

### Type Literal

\{ `content`: [`AgentSessionMentionedMetadata`](AgentSessionMentionedMetadata.md); `tag`: `"agent_session_mentioned"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`AgentSessionMentionedMetadata`](AgentSessionMentionedMetadata.md) | The user was named in a prompt to an agent session. |
| `tag` | `"agent_session_mentioned"` | - |

***

### Type Literal

\{ `content`: [`ChannelMessageReactionMetadata`](ChannelMessageReactionMetadata.md); `tag`: `"channel_message_reaction"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`ChannelMessageReactionMetadata`](ChannelMessageReactionMetadata.md) | Someone reacted to one of the user's channel messages. |
| `tag` | `"channel_message_reaction"` | - |
