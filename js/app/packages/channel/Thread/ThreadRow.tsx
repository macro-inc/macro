import type { ApiChannelMessage } from '@service-comms/client';
import type { ParentProps } from 'solid-js';
import {
  DateDivider,
  NewDivider,
  type ChannelMessageListMeta,
} from '../Message';

type ThreadRowProps = ParentProps & {
  message: ApiChannelMessage;
  listMeta?: ChannelMessageListMeta;
  onDismissNewMessages?: () => void;
};

export function ThreadRow(props: ThreadRowProps) {
  return (
    <div class="w-full flex justify-center">
      <div class="macro-message-width w-full relative">
        <div
          class="pointer-events-none absolute top-0 bottom-0 border-l border-edge-muted/60"
          style={{
            left: 'var(--left-of-connector)',
          }}
        />
        <NewDivider
          listMeta={props.listMeta}
          onDismiss={props.onDismissNewMessages}
        />
        <DateDivider
          createdAt={props.message.created_at}
          listMeta={props.listMeta}
        />
        {props.children}
      </div>
    </div>
  );
}
