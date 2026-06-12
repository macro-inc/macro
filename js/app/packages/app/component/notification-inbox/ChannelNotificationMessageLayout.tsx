import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import type { UnifiedNotification } from '@notifications';
import AtIcon from '@phosphor/at.svg';
import ChatIcon from '@phosphor/chat.svg';
import { Show } from 'solid-js';
import { NotificationListIcon } from './NotificationListIcon';
import { NotificationMessageLayout } from './NotificationMessageLayout';

const getChannelContent = (notification: UnifiedNotification) => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'channel_message_send' ||
    metadata.tag === 'channel_mention'
    ? metadata.content
    : undefined;
};

const getSenderFallback = (notification: UnifiedNotification): string => {
  const metadata = notification.notification_metadata;
  return metadata.tag === 'channel_message_send'
    ? (metadata.content.sender ?? 'Unknown')
    : (notification.sender_id ?? 'Unknown');
};

const getAction = (notification: UnifiedNotification): string => {
  switch (notification.notification_metadata.tag) {
    case 'channel_mention':
      return 'Mentioned you';
    case 'channel_message_send':
      return 'Sent a message';
    default:
      return 'Sent a message';
  }
};

function ActionIcon(props: { notification: UnifiedNotification }) {
  return props.notification.notification_metadata.tag === 'channel_mention' ? (
    <AtIcon class="size-3.5" />
  ) : (
    <ChatIcon class="size-3.5" />
  );
}

export function ChannelNotificationMessageLayout(props: {
  notification: UnifiedNotification;
}) {
  const content = () => getChannelContent(props.notification);
  const senderId = () =>
    props.notification.sender_id ?? getSenderFallback(props.notification);
  const macroId = () => tryMacroId(senderId());
  const [displayName] = useDisplayName(macroId());
  const senderName = () =>
    displayName() || getSenderFallback(props.notification);
  const isDirectMessage = () => content()?.channelType === 'directMessage';
  const title = () => {
    const action = getAction(props.notification);
    if (isDirectMessage()) return `${action} in a DM`;
    return `${action} in ${content()?.channelName ?? 'Channel'}`;
  };
  const subtitle = () => senderName();
  return (
    <NotificationMessageLayout
      notification={props.notification}
      action={title()}
      actionIcon={<ActionIcon notification={props.notification} />}
      icon={
        <Show
          when={macroId()}
          fallback={<NotificationListIcon notification={props.notification} />}
        >
          {(id) => <UserIcon id={id()} size="fill" suppressClick showTooltip />}
        </Show>
      }
      title={subtitle()}
      description={
        <Show when={content()?.messageContent?.trim()}>
          {(messageContent) => (
            <StaticMarkdown
              markdown={messageContent()}
              theme={unifiedListMarkdownTheme}
              singleLine
            />
          )}
        </Show>
      }
    />
  );
}
