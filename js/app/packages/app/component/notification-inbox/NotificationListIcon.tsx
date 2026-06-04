import { EntityIcon } from '@core/component/EntityIcon';
import type { NotificationType } from '@core/types';
import GithubIcon from '@icon/mcp-github.svg';
import PhoneIcon from '@icon/wide-call.svg';
import WideFilesIcon from '@icon/wide-files.svg';
import type { UnifiedNotification } from '@notifications';
import ArrowBendUpLeftIcon from '@phosphor/arrow-bend-up-left.svg';
import AtIcon from '@phosphor/at.svg';
import ChatIcon from '@phosphor/chat.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';

const entityIcon =
  (targetType: 'email' | 'chat' | 'task') => (props: { class?: string }) => (
    <EntityIcon targetType={targetType} size="xs" class={props.class} />
  );

function getNotificationIcon(
  type: NotificationType
): (props: { class?: string }) => JSX.Element {
  return match(type)
    .with('channel_mention', () => AtIcon)
    .with('document_mention', () => WideFilesIcon)
    .with('mentioned_in_document_comment', () => AtIcon)
    .with('replied_to_document_comment_thread', () => ArrowBendUpLeftIcon)
    .with('commented_on_document', () => ChatIcon)
    .with('channel_message_reply', () => ArrowBendUpLeftIcon)
    .with('channel_message_send', () => ChatIcon)
    .with('new_email', () => entityIcon('email'))
    .with('channel_invite', () => UserPlusIcon)
    .with('invite_to_team', () => UserPlusIcon)
    .with('task_assigned', () => entityIcon('task'))
    .with('ai_response', () => entityIcon('chat'))
    .with('github_pr_event', () => GithubIcon)
    .with('call-started', () => PhoneIcon)
    .exhaustive();
}

export function NotificationListIcon(props: {
  notification: UnifiedNotification;
  class?: string;
}) {
  const icon = () =>
    getNotificationIcon(props.notification.notification_metadata.tag);

  return <Dynamic component={icon()} class={cn('size-4', props.class)} />;
}
