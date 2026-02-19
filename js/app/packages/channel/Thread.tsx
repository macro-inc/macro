import type { ApiChannelMessage } from '@service-comms/client';
import { useThreadRepliesQuery } from '@queries/channel/thread-replies';
import {
  type Accessor,
  type Setter,
  createSignal,
  Show,
  For,
  Suspense,
} from 'solid-js';
import { ChannelMessage } from './Message';

export type ThreadState = {
  isExpanded: Accessor<boolean>;
  setIsExpanded: Setter<boolean>;
};

export type ThreadProps = {
  data: Accessor<ApiChannelMessage>;
  channelId: Accessor<string>;
} & ThreadState;

const DEFAULT_REPLY_COUNT = 3;

export function Thread(props: ThreadProps) {
  const [isReplying, setIsReplying] = createSignal(false);
  const [replyContent, setReplyContent] = createSignal('');

  const thread = () => props.data().thread;
  const hasReplies = () => thread().reply_count > 0;

  const repliesQuery = useThreadRepliesQuery(
    props.channelId,
    () => props.data().id,
    props.isExpanded
  );

  const previewReplies = () => thread().preview.slice(0, DEFAULT_REPLY_COUNT);
  const fetchedReplies = () => repliesQuery.data?.items ?? [];
  const moreRepliesCount = () => thread().reply_count - DEFAULT_REPLY_COUNT;

  const expand = () => {
    props.setIsExpanded(true);
  };

  const sendReply = () => {
    // TODO: wire up to postMessage with thread_id
    setReplyContent('');
    setIsReplying(false);
  };

  return (
    <div class="flex flex-col w-full">
      <ChannelMessage message={props.data()} />
      <Show when={hasReplies()}>
        <div class="flex flex-col w-full pl-5">
          <For each={previewReplies()}>
            {(reply) => <ChannelMessage message={reply} />}
          </For>
          <Show when={!props.isExpanded() && moreRepliesCount() > 0}>
            <button onClick={expand}>
              Show {moreRepliesCount()} more{' '}
              {moreRepliesCount() === 1 ? 'reply' : 'replies'}
            </button>
          </Show>
          <Show when={props.isExpanded()}>
            <Suspense>
              <For each={fetchedReplies()}>
                {(reply) => <ChannelMessage message={reply} />}
              </For>
            </Suspense>
          </Show>
          <Show
            when={isReplying()}
            fallback={
              <button onClick={() => setIsReplying(true)}>Reply</button>
            }
          >
            <div class="flex flex-col w-full">
              <textarea
                value={replyContent()}
                onInput={(e) => setReplyContent(e.currentTarget.value)}
              />
              <button onClick={sendReply}>Send</button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
