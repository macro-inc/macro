import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import type { NotificationType } from '@core/types';
import { tryMacroId } from '@core/user';
import GithubIcon from '@icon/mcp-github.svg';
import PhoneIcon from '@icon/wide-call.svg';
import WideFilesIcon from '@icon/wide-files.svg';
import type { UnifiedNotification } from '@notifications';
import ArrowBendUpLeftIcon from '@phosphor/arrow-bend-up-left.svg';
import AtIcon from '@phosphor/at.svg';
import ChatIcon from '@phosphor/chat.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';

const entityIcon =
  (targetType: 'email' | 'chat' | 'task') => (props: { class?: string }) => (
    <EntityIcon targetType={targetType} size="sm" class={props.class} />
  );

const getChannelIconType = (
  notification: UnifiedNotification
): EntityIconSelector => {
  const metadata = notification.notification_metadata;
  if (metadata.tag !== 'channel_message_send') return 'channel';

  return metadata.content.channelType === 'directMessage'
    ? 'direct_message'
    : (metadata.content.channelType ?? 'channel');
};

const getChannelMessageSenderId = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;
  if (metadata.tag !== 'channel_message_send') return undefined;
  return notification.sender_id ?? metadata.content.sender ?? undefined;
};

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
    .with('github_pr_status_changed', () => GithubIcon)
    .with('github_review_requested', () => GithubIcon)
    .with('github_pr_comment', () => GithubIcon)
    .with('github_pr_mention', () => GithubIcon)
    .with('github_pr_review', () => GithubIcon)
    .with('call-started', () => PhoneIcon)
    .exhaustive();
}

export function NotificationListIcon(props: {
  notification: UnifiedNotification;
  class?: string;
}) {
  const icon = () =>
    getNotificationIcon(props.notification.notification_metadata.tag);

  if (props.notification.notification_metadata.tag === 'channel_message_send') {
    const senderId = () =>
      props.notification.notification_metadata.tag === 'channel_message_send' &&
      props.notification.notification_metadata.content.channelType ===
        'directMessage'
        ? tryMacroId(getChannelMessageSenderId(props.notification) ?? '')
        : undefined;

    return (
      <Show
        when={senderId()}
        fallback={
          <EntityIcon
            targetType={getChannelIconType(props.notification)}
            size="xs"
            class={cn('size-4 overflow-visible', props.class)}
          />
        }
      >
        {(id) => <UserIcon id={id()} size="sm" suppressClick showTooltip />}
      </Show>
    );
  }

  return (
    <Dynamic
      component={icon()}
      class={cn('size-4 overflow-visible', props.class)}
    />
  );
}
