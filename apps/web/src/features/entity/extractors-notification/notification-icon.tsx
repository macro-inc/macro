import type { NotificationType } from '@core/types';
import GithubIcon from '@icon/mcp-github.svg';
import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import AtIcon from '@icon/system/regular/at.svg';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import ChatIcon from '@icon/system/regular/chat.svg';
import ChatTeardropIcon from '@icon/system/regular/chat-teardrop.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FilesIcon from '@icon/system/regular/files.svg';
import PhoneIcon from '@icon/system/regular/phone-call.svg';
import QuestionIcon from '@icon/system/regular/question.svg';
import SmileyIcon from '@icon/system/regular/smiley.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import type { NotificationStack } from '@notifications';
import { isEntityDiscussionEvent } from '@notifications/entity-discussion';
import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match, P } from 'ts-pattern';
import type { Notification } from '../types/notification';

interface NotificationIconProps {
  notification?: Notification;
  stack?: NotificationStack;
  class?: string;
}

/**
 * Gets the appropriate icon for a notification type
 */
function getNotificationIcon(
  type: NotificationType
): (props: { class?: string }) => JSX.Element {
  return match(type)
    .with('channel_mention', () => AtIcon)
    .with('document_mention', () => FilesIcon)
    .with(
      P.union(
        'mentioned_in_document_comment',
        'replied_to_document_comment_thread',
        'commented_on_document',
        'crm_discussion'
      ),
      () => ChatTeardropIcon
    )
    .with('initiative_discussion', () => ChatIcon)
    .with('channel_message_reply', () => ArrowBendUpLeftIcon)
    .with('channel_message_send', () => ChatIcon)
    .with('channel_message_reaction', () => SmileyIcon)
    .with('new_email', () => EnvelopeIcon)
    .with('channel_invite', () => UserPlusIcon)
    .with('invite_to_team', () => UserPlusIcon)
    .with('task_assigned', () => CheckIcon)
    .with('ai_response', () => ChatIcon)
    .with(
      P.union(
        'github_pr_status_changed',
        'github_pr_check_run',
        'github_review_requested',
        'github_pr_comment',
        'github_pr_mention',
        'github_pr_review'
      ),
      () => GithubIcon
    )
    .with('call_started', () => PhoneIcon)
    .with('reminder', () => BellIcon)
    .with('calendar_event_reminder', () => CalendarBlankIcon)
    .with('inbox_reauth_required', () => EnvelopeIcon)
    .with('agent_session_settled', () => AgentIcon)
    .with('agent_session_waiting_for_input', () => QuestionIcon)
    .with('agent_session_mentioned', () => AtIcon)
    .exhaustive();
}

/**
 * Displays the appropriate icon for a notification or stack
 */
export function NotificationIcon(props: NotificationIconProps) {
  const notificationType = (): NotificationType | undefined => {
    if (props.stack) return props.stack.type;
    if (props.notification) return props.notification.notification_metadata.tag;
    return undefined;
  };

  const icon = () => {
    const metadata = (props.notification ?? props.stack?.notifications[0])
      ?.notification_metadata;
    if (isEntityDiscussionEvent(metadata)) {
      if (metadata.content.reason === 'mention') return AtIcon;
      if (metadata.content.reason === 'reply') return ArrowBendUpLeftIcon;
    }
    const type = notificationType();
    if (!type) return ChatIcon;
    return getNotificationIcon(type);
  };

  return <Dynamic component={icon()} class={cn('size-4', props.class)} />;
}
