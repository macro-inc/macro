import { ChannelAvatar } from '@channel/channel-avatar';
import { InboxSenderAvatar } from '../components/inbox-sender-avatar';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import { inboxCardKind } from '../primitives/describe-row';

/**
 * A group chat's inbox row shows the chat itself, not whoever wrote in it
 * last: its picture, or the channel kind where it has none.
 */
export function GroupChatAvatar(props: {
  channelId: string;
  row: NotificationInboxRow;
}) {
  return (
    <span class="block size-6 mobile:size-10">
      <ChannelAvatar
        channelId={props.channelId}
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
  );
}
