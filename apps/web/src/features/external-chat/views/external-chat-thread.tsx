import type { InputHandle } from '@channel/Input/types';
import { Thread } from '@channel/Thread';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { useExternalChat } from '../context/external-chat-context';
import type { ChatDetail, ChatMessage } from '../core/chat';

/**
 * A message's thread, inline under it like a channel thread: the reply-count
 * chip expands the replies and a composer for the thread, and the reply
 * button starts one. Only providers with threads (`limits.threads`) show it.
 */
export function ExternalChatThread(props: {
  root: ChatMessage;
  /** Whom the composer may mention, and whether the viewer may send. */
  chat: ChatDetail;
  /** One reply row, drawn like a timeline message. */
  renderMessage: (message: ChatMessage) => JSX.Element;
  /** This page's unsent replies, after the stored ones. */
  pending: ChatMessage[];
  /** The thread's composer, sending in this thread. */
  composer: (input: {
    id: string;
    onReady: (handle: InputHandle) => void;
  }) => JSX.Element;
  /** The thread's composer, for restoring a draft that wasn't sent. */
  onComposer: (handle: InputHandle | undefined) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const summary = () => props.root.thread;
  const canReply = () => props.chat.canSend && !props.root.pending;

  return (
    <Show when={props.chat.limits.threads && !props.root.deleted}>
      <Show
        when={expanded()}
        fallback={
          <Show when={summary() || canReply()}>
            <Thread.ActionsFooter>
              <div class="flex items-center gap-2">
                <Show when={summary()}>
                  {(thread) => (
                    <Thread.CollapsedIndicator
                      collapsedRepliesCount={thread().replyCount}
                      participants={[]}
                      latestReplyAt={thread().lastReplyAt}
                      hasNewMessages={thread().unread}
                      withoutPreview
                      onClick={() => setExpanded(true)}
                    />
                  )}
                </Show>
                <Show when={!summary() && canReply()}>
                  <Thread.ReplyButton
                    aria-label="Reply in thread"
                    onClick={() => setExpanded(true)}
                  />
                </Show>
              </div>
            </Thread.ActionsFooter>
          </Show>
        }
      >
        <ThreadReplies
          root={props.root}
          canReply={canReply()}
          renderMessage={props.renderMessage}
          pending={props.pending}
          composer={props.composer}
          onComposer={props.onComposer}
          onHide={() => setExpanded(false)}
        />
      </Show>
    </Show>
  );
}

/** An expanded thread: its replies, then its composer. */
function ThreadReplies(props: {
  root: ChatMessage;
  canReply: boolean;
  renderMessage: (message: ChatMessage) => JSX.Element;
  pending: ChatMessage[];
  composer: (input: {
    id: string;
    onReady: (handle: InputHandle) => void;
  }) => JSX.Element;
  onComposer: (handle: InputHandle | undefined) => void;
  onHide: () => void;
}) {
  const source = useExternalChat();
  const replies = source.thread(() => props.root.id);
  const stored = () => (replies.isPending ? [] : (replies.data ?? []));
  onCleanup(() => props.onComposer(undefined));

  // An open thread is being read: mark its newest reply.
  createEffect(
    on(
      () => stored().at(-1)?.id,
      (newest) => {
        if (newest && props.root.thread?.unread)
          fireAndForget(
            source.markThreadRead(newest),
            'external-chat.thread-read'
          );
      }
    )
  );

  return (
    <Thread.RepliesContainer>
      <Show when={replies.isError}>
        <p class="px-(--message-padding-x) py-1 text-xs text-ink-muted">
          Couldn't load this thread.
        </p>
      </Show>
      <For each={[...stored(), ...props.pending]}>
        {(reply) => props.renderMessage(reply)}
      </For>
      <div class="mt-1 px-(--message-padding-x)">
        <button
          type="button"
          class="text-xs text-ink-muted not-touch:hover:text-ink"
          onClick={props.onHide}
        >
          Hide replies
        </button>
      </div>
      <Show when={props.canReply}>
        <div class="mt-2 px-(--message-padding-x)">
          {props.composer({
            id: `external-chat-thread-input-${props.root.id}`,
            onReady: props.onComposer,
          })}
        </div>
      </Show>
    </Thread.RepliesContainer>
  );
}
