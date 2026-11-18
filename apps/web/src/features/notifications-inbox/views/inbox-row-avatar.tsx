import { ChannelAvatar } from '@channel/channel-avatar';
import { Show } from 'solid-js';
import { InboxSenderAvatar } from '../components/inbox-sender-avatar';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import { groupChatId, inboxCardKind } from '../primitives/describe-row';

/**
 * Who an inbox row is from: the sender of its newest notification, except in a
 * group chat, which shows the chat itself rather than whoever wrote in it
 * last: its picture, or the channel kind where it has none.
 */
export function InboxRowAvatar(props: { row: NotificationInboxRow }) {
  return (
    <Show
      when={groupChatId(props.row)}
      fallback={
        <InboxSenderAvatar
          notification={props.row.content.notifications[0]}
          kind={inboxCardKind(props.row)}
          entity={props.row.content.entity}
          badged
        />
      }
    >
      {(channelId) => (
        <span class="block size-6 mobile:size-10" data-group-chat-avatar="">
          <ChannelAvatar
            channelId={channelId()}
            class="size-full"
            fallback={
              <InboxSenderAvatar
                notification={undefined}
                kind={inboxCardKind(props.row)}
                entity={props.row.content.entity}
              />
            }
          />
        </span>
      )}
    </Show>
  );
}
