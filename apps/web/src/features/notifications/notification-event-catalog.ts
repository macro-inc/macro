import { type TranslationKey, t } from '@app/lib/i18n';
import { match } from 'ts-pattern';

/**
 * Event types the notification service lets a user disable.
 * Keep this list aligned with `BLOCKABLE_NOTIFICATIONS` in
 * `services/notification_service/src/api/user_notification.rs`.
 * `email-digest-notification` is a delivery control, not an inbox event.
 */

export const EMAIL_DIGEST_NOTIFICATION_TYPE =
  'email-digest-notification' as const;

export type NotificationEventGroupId =
  | 'channels'
  | 'projects'
  | 'documents'
  | 'sharing'
  | 'crm'
  | 'tasks'
  | 'calendar'
  | 'email'
  | 'ai'
  | 'github';

/**
 * `label` and `description` are in the interface language: read them where
 * they render, or inside `inEnglish` for a value that must not change with it.
 */
export type NotificationEventDefinition = {
  type: string;
  readonly label: string;
  readonly description: string;
  /** Shown only with `enable-macro-computers` on. */
  readonly macroComputers?: true;
};

export type NotificationEventGroup = {
  id: NotificationEventGroupId;
  readonly label: string;
  events: readonly NotificationEventDefinition[];
};

const event = (
  type: string,
  label: TranslationKey,
  description: TranslationKey,
  options: { macroComputers?: true } = {}
): NotificationEventDefinition => ({
  type,
  ...options,
  get label() {
    return t(label);
  },
  get description() {
    return t(description);
  },
});

const group = (
  id: NotificationEventGroupId,
  label: TranslationKey,
  events: readonly NotificationEventDefinition[]
): NotificationEventGroup => ({
  id,
  get label() {
    return t(label);
  },
  events,
});

export const NOTIFICATION_EVENT_GROUPS: readonly NotificationEventGroup[] = [
  group('sharing', 'settingsNotifications.groupSharing', [
    event(
      'entity_access_requested',
      'settingsNotifications.eventEntityAccessRequested',
      'settingsNotifications.eventEntityAccessRequestedDescription'
    ),
    event(
      'entity_access_granted',
      'settingsNotifications.eventEntityAccessGranted',
      'settingsNotifications.eventEntityAccessGrantedDescription'
    ),
  ]),
  group('channels', 'settingsNotifications.groupChannels', [
    event(
      'channel_message_send',
      'settingsNotifications.eventChannelMessageSend',
      'settingsNotifications.eventChannelMessageSendDescription'
    ),
    event(
      'channel_mention',
      'settingsNotifications.eventChannelMention',
      'settingsNotifications.eventChannelMentionDescription'
    ),
    event(
      'channel_message_reply',
      'settingsNotifications.eventChannelMessageReply',
      'settingsNotifications.eventChannelMessageReplyDescription'
    ),
    event(
      'channel_message_reaction',
      'settingsNotifications.eventChannelMessageReaction',
      'settingsNotifications.eventChannelMessageReactionDescription'
    ),
    event(
      'channel_access_requested',
      'settingsNotifications.eventChannelAccessRequested',
      'settingsNotifications.eventChannelAccessRequestedDescription'
    ),
  ]),
  group('documents', 'settingsNotifications.groupDocuments', [
    event(
      'document_mention',
      'settingsNotifications.eventDocumentMention',
      'settingsNotifications.eventDocumentMentionDescription'
    ),
    event(
      'mentioned_in_document_comment',
      'settingsNotifications.eventMentionedInDocumentComment',
      'settingsNotifications.eventMentionedInDocumentCommentDescription'
    ),
    event(
      'replied_to_document_comment_thread',
      'settingsNotifications.eventRepliedToDocumentCommentThread',
      'settingsNotifications.eventRepliedToDocumentCommentThreadDescription'
    ),
    event(
      'commented_on_document',
      'settingsNotifications.eventCommentedOnDocument',
      'settingsNotifications.eventCommentedOnDocumentDescription'
    ),
  ]),
  group('projects', 'settingsNotifications.groupProjects', [
    event(
      'initiative_discussion',
      'settingsNotifications.eventInitiativeDiscussion',
      'settingsNotifications.eventInitiativeDiscussionDescription'
    ),
  ]),
  group('crm', 'settingsNotifications.groupCrm', [
    event(
      'crm_discussion',
      'settingsNotifications.eventCrmDiscussion',
      'settingsNotifications.eventCrmDiscussionDescription'
    ),
  ]),
  group('tasks', 'settingsNotifications.groupTasks', [
    event(
      'task_assigned',
      'settingsNotifications.eventTaskAssigned',
      'settingsNotifications.eventTaskAssignedDescription'
    ),
  ]),
  group('calendar', 'settingsNotifications.groupCalendar', [
    event(
      'calendar_event_reminder',
      'settingsNotifications.eventCalendarEventReminder',
      'settingsNotifications.eventCalendarEventReminderDescription'
    ),
    event(
      'calendar_event_join_request',
      'settingsNotifications.eventCalendarEventJoinRequest',
      'settingsNotifications.eventCalendarEventJoinRequestDescription'
    ),
  ]),
  group('email', 'settingsNotifications.groupEmail', [
    event(
      'new_email',
      'settingsNotifications.eventNewEmail',
      'settingsNotifications.eventNewEmailDescription'
    ),
  ]),
  group('ai', 'settingsNotifications.groupAi', [
    event(
      'ai_response',
      'settingsNotifications.eventAiResponse',
      'settingsNotifications.eventAiResponseDescription'
    ),
    event(
      'agent_session_settled',
      'settingsNotifications.eventAgentSessionSettled',
      'settingsNotifications.eventAgentSessionSettledDescription'
    ),
    event(
      'agent_session_waiting_for_input',
      'settingsNotifications.eventAgentSessionWaitingForInput',
      'settingsNotifications.eventAgentSessionWaitingForInputDescription'
    ),
    event(
      'agent_session_mentioned',
      'settingsNotifications.eventAgentSessionMentioned',
      'settingsNotifications.eventAgentSessionMentionedDescription'
    ),
    event(
      'routine_run_finished',
      'settingsNotifications.eventRoutineRunFinished',
      'settingsNotifications.eventRoutineRunFinishedDescription'
    ),
    event(
      'agent_sign_in_expiry',
      'settingsNotifications.eventAgentSignInExpiry',
      'settingsNotifications.eventAgentSignInExpiryDescription',
      { macroComputers: true }
    ),
    event(
      'computer_setup',
      'settingsNotifications.eventComputerSetup',
      'settingsNotifications.eventComputerSetupDescription',
      { macroComputers: true }
    ),
  ]),
  group('github', 'settingsNotifications.groupGithub', [
    event(
      'github_pr_status_changed',
      'settingsNotifications.eventGithubPrStatusChanged',
      'settingsNotifications.eventGithubPrStatusChangedDescription'
    ),
    event(
      'github_review_requested',
      'settingsNotifications.eventGithubReviewRequested',
      'settingsNotifications.eventGithubReviewRequestedDescription'
    ),
    event(
      'github_pr_comment',
      'settingsNotifications.eventGithubPrComment',
      'settingsNotifications.eventGithubPrCommentDescription'
    ),
    event(
      'github_pr_mention',
      'settingsNotifications.eventGithubPrMention',
      'settingsNotifications.eventGithubPrMentionDescription'
    ),
    event(
      'github_pr_review',
      'settingsNotifications.eventGithubPrReview',
      'settingsNotifications.eventGithubPrReviewDescription'
    ),
  ]),
];

export const BLOCKABLE_NOTIFICATION_EVENT_TYPES: readonly string[] =
  NOTIFICATION_EVENT_GROUPS.flatMap((group) =>
    group.events.map((event) => event.type)
  );

/** What kind of item a muted item is, shown when its own name is unknown. */
export function mutedEntityTypeLabel(itemType: string): string {
  return match(itemType)
    .with('calendar_event', () =>
      t('settingsNotifications.entityCalendarEvent')
    )
    .with('call', () => t('settingsNotifications.entityCall'))
    .with('channel', () => t('settingsNotifications.entityChannel'))
    .with('channel_message', () => t('settingsNotifications.entityThread'))
    .with('chat', () => t('settingsNotifications.entityChat'))
    .with('document', () => t('settingsNotifications.entityDocument'))
    .with('email', 'email_thread', () => t('settingsNotifications.entityEmail'))
    .with('foreign', 'foreign_entity', () =>
      t('settingsNotifications.entityGithub')
    )
    .with('project', () => t('settingsNotifications.entityFolder'))
    .with('initiative', () => t('settingsNotifications.entityProject'))
    .with('crm_company', () => t('settingsNotifications.entityCompany'))
    .with('crm_contact', () => t('settingsNotifications.entityContact'))
    .with('reminder', () => t('settingsNotifications.entityReminder'))
    .with('team', () => t('settingsNotifications.entityTeam'))
    .otherwise(() => itemType.replace(/_/g, ' '));
}
