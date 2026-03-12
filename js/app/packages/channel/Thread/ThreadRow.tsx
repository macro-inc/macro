import type { ApiChannelMessage } from '@service-comms/client';
import type { ParentProps } from 'solid-js';
import {
  DateDivider,
  NewDivider,
  type ChannelMessageListMeta,
} from '../Message';
import { ThreadRail } from './ThreadRail';

type ThreadRowProps = ParentProps & {
  message: ApiChannelMessage;
  listMeta?: ChannelMessageListMeta;
  onDismissNewMessages?: () => void;
};

export function ThreadRow(props: ThreadRowProps) {
  return (
    <div class="w-full flex justify-center">
      <div class="macro-message-width w-full relative">
        <NewDivider
          listMeta={props.listMeta}
          onDismiss={props.onDismissNewMessages}
        />
        <DateDivider
          createdAt={props.message.created_at}
          listMeta={props.listMeta}
        />
        <div class="relative">
          <ThreadRail newMessage={props.listMeta?.isNewMessage} />
          {props.children}
        </div>
      </div>
    </div>
  );
}
