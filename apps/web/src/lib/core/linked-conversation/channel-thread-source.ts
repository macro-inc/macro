import { useChannelMessagesByIdsQuery } from '@queries/channel/channel-messages';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { Accessor } from 'solid-js';
import type {
  LinkedConversationMessage,
  LinkedConversationSource,
} from './types';

type ChannelThreadSourceProps = {
  channelId: Accessor<string>;
  messageId: Accessor<string>;
  /** Pre-fetched root message; skips the lookup query when provided. */
  data?: Accessor<ApiChannelMessage | undefined>;
};

/**
 * A [`LinkedConversationSource`] backed by a channel thread: the root channel
 * message plus its reply chain. Must be called in a component context — it
 * mounts queries.
 */
export function createChannelThreadSource(
  props: ChannelThreadSourceProps
): LinkedConversationSource {
  const rootQuery = useChannelMessagesByIdsQuery(props.channelId, () =>
    props.data?.() ? [] : [props.messageId()]
  );
  const root = () => props.data?.() ?? rootQuery.data?.[0];
  const replyCount = () => root()?.thread.reply_count;

  const repliesQuery = useThreadRepliesQuery(
    props.channelId,
    props.messageId,
    () => (replyCount() ?? 0) > 0
  );
  const replies = (): LinkedConversationMessage[] =>
    (repliesQuery.data ?? root()?.thread.preview ?? []).map((reply) => ({
      ...reply,
      thread_id: props.messageId(),
    }));

  return { root, replies, replyCount };
}
