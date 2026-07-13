import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import { type ParentProps, Show } from 'solid-js';
import {
  ChannelCreatedIndicator,
  type ChannelMessageListMeta,
  DateDivider,
  NewDivider,
} from '../Message';
import { ThreadRail } from './ThreadRail';

type ThreadRowProps = ParentProps & {
  /** Present only in channel threads; other consumers (calls, PRs, comments) omit it. */
  channelId?: string;
  message: ApiChannelMessage;
  listMeta?: ChannelMessageListMeta;
  onDismissNewMessages?: () => void;
};

export function ThreadRow(props: ThreadRowProps) {
  const channelCreatedId = () =>
    props.listMeta?.index === 0 && props.listMeta?.reachedStart
      ? props.channelId
      : undefined;

  return (
    <div class="w-full flex justify-center">
      <div class="macro-message-width w-full relative">
        <Show when={channelCreatedId()}>
          {(id) => <ChannelCreatedIndicator channelId={id()} />}
        </Show>
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
