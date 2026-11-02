import type { NotifEvent } from '@service-notification/generated/schemas';
import type { NotificationSoundId } from './sounds';

export type NotificationSoundCategoryId =
  | 'messages'
  | 'mentions'
  | 'replies'
  | 'email'
  | 'meetings'
  | 'tasks'
  | 'agents'
  | 'other';

export type NotificationSoundCategory = {
  id: NotificationSoundCategoryId;
  label: string;
  description: string;
  defaultEnabled: boolean;
  defaultSound: NotificationSoundId;
};

/** Settings rows, in display order. */
export const NOTIFICATION_SOUND_CATEGORIES: readonly NotificationSoundCategory[] =
  [
    {
      id: 'messages',
      label: 'Messages',
      description: 'New messages in channels and direct messages',
      defaultEnabled: true,
      defaultSound: 'knock',
    },
    {
      id: 'mentions',
      label: 'Mentions',
      description: 'When someone mentions you anywhere',
      defaultEnabled: true,
      defaultSound: 'ding',
    },
    {
      id: 'replies',
      label: 'Thread replies',
      description: 'Replies in threads and comment threads you are part of',
      defaultEnabled: true,
      defaultSound: 'pop',
    },
    {
      id: 'email',
      label: 'Email',
      description: 'When a new email arrives',
      defaultEnabled: false,
      defaultSound: 'pluck',
    },
    {
      id: 'meetings',
      label: 'Meetings & reminders',
      description: 'Event reminders, requests to join, and your reminders',
      defaultEnabled: true,
      defaultSound: 'chime',
    },
    {
      id: 'tasks',
      label: 'Tasks',
      description: 'When a task is assigned to you',
      defaultEnabled: true,
      defaultSound: 'bloom',
    },
    {
      id: 'agents',
      label: 'AI & agents',
      description: 'AI replies, and agents that finish or need an answer',
      defaultEnabled: false,
      defaultSound: 'ping',
    },
    {
      id: 'other',
      label: 'Everything else',
      description: 'Comments, reactions, sharing, GitHub, and invites',
      defaultEnabled: false,
      defaultSound: 'pop',
    },
  ];

/**
 * The sound category for each notification event. `null` events never make a
 * sound: incoming calls ring on their own, and document mentions are not
 * delivered as alerts.
 */
const CATEGORY_BY_EVENT: Record<
  NotifEvent['tag'],
  NotificationSoundCategoryId | null
> = {
  channel_message_send: 'messages',
  external_chat_message: 'messages',
  channel_mention: 'mentions',
  mentioned_in_document_comment: 'mentions',
  agent_session_mentioned: 'mentions',
  github_pr_mention: 'mentions',
  channel_message_reply: 'replies',
  replied_to_document_comment_thread: 'replies',
  new_email: 'email',
  calendar_event_reminder: 'meetings',
  calendar_event_join_request: 'meetings',
  reminder: 'meetings',
  task_assigned: 'tasks',
  ai_response: 'agents',
  agent_session_settled: 'agents',
  agent_session_waiting_for_input: 'agents',
  commented_on_document: 'other',
  channel_message_reaction: 'other',
  channel_invite: 'other',
  initiative_discussion: 'other',
  crm_discussion: 'other',
  entity_access_requested: 'other',
  entity_access_granted: 'other',
  invite_to_team: 'other',
  inbox_reauth_required: 'other',
  github_pr_status_changed: 'other',
  github_pr_check_run: 'other',
  github_review_requested: 'other',
  github_pr_comment: 'other',
  github_pr_review: 'other',
  call_started: null,
  document_mention: null,
};

function isMappedEvent(tag: string): tag is NotifEvent['tag'] {
  return Object.hasOwn(CATEGORY_BY_EVENT, tag);
}

/** Events a newer backend adds have no category until mapped here. */
export function soundCategoryForEvent(
  tag: string
): NotificationSoundCategoryId | null {
  return isMappedEvent(tag) ? CATEGORY_BY_EVENT[tag] : null;
}

export function notificationSoundCategory(
  id: NotificationSoundCategoryId
): NotificationSoundCategory {
  const category = NOTIFICATION_SOUND_CATEGORIES.find(
    (candidate) => candidate.id === id
  );
  if (!category) throw new Error(`Unknown notification sound category: ${id}`);
  return category;
}
