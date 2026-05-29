import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { ParentProps } from 'solid-js';
import {
  type ChannelMessageListMeta,
  DateDivider,
  NewDivider,
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
        <div class="relative isolate">
          <ThreadRail newMessage={props.listMeta?.isNewMessage} />
          {props.children}
        </div>
      </div>
    </div>
  );
}
