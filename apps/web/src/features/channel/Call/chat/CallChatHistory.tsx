import { t } from '@app/lib/i18n';
import { buildMessageLink } from '@channel/Thread/utils/message-actions';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { MessageThread, threadListItem } from '@core/messages/MessageThread';
import { fireAndForget } from '@core/util/fireAndForget';
import { threadRepliesQueryOptions } from '@queries/messages/thread-replies';
import type { MessageThread as ThreadData } from '@service-storage/messages';
import { useQuery } from '@tanstack/solid-query';
import { type JSX, Show, Suspense } from 'solid-js';
import type { CallDiscussion } from '../discussion/call-discussion';
import { buildCallMessageLink } from './build-call-message-link';
import { useCallChat } from './queries/use-call-chat';

export type CallDiscussionSource = {
  thread: () => ThreadData | undefined;
  loading: () => boolean;
  empty: () => boolean;
  failed: () => boolean;
  refresh: () => Promise<unknown>;
};
type CallChatHistoryProps = {
  callId: string;
  targetId?: string;
  targetRequestKey?: string | number;
  onClearTarget?: () => void;
  render?: (source: CallDiscussionSource) => JSX.Element;
};

/** Saved call chat shares the live thread cache and read-only message controls. */
export function CallChatHistory(props: CallChatHistoryProps) {
  if (props.render) return <CallChatHistoryContent {...props} />;
  return (
    <section class="flex min-w-0 flex-col gap-3" aria-label="Call chat">
      <h3 class="text-sm font-semibold text-ink">Call chat</h3>
      <Suspense fallback={<p class="text-sm text-ink-muted">Loading chat…</p>}>
        <CallChatHistoryContent {...props} />
      </Suspense>
    </section>
  );
}

/**
 * A channel call's discussion, on its record: read-only, and only for people
 * who can read the channel. Sharing a record doesn't open part of a channel.
 */
function ChannelThreadHistory(props: {
  channelId: string;
  rootId: string;
  targetId?: string;
  targetRequestKey?: string | number;
  onClearTarget?: () => void;
  render?: (source: CallDiscussionSource) => JSX.Element;
}) {
  const parent = () => ({ type: 'channel' as const, id: props.channelId });
  const thread = useQuery(() => ({
    ...threadRepliesQueryOptions(parent(), props.rootId),
    retry: false,
  }));
  if (props.render) {
    return props.render({
      thread: () => (thread.isSuccess ? thread.data : undefined),
      loading: () => thread.isPending,
      empty: () => thread.isSuccess && thread.data.replies.length === 0,
      failed: () => thread.isError,
      refresh: () => thread.refetch(),
    });
  }

  return (
    <Show when={thread.isSuccess && thread.data}>
      {(data) => (
        <section class="flex min-w-0 flex-col gap-3" aria-label="Call chat">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-ink">Call chat</h3>
            <a
              class="text-xs text-ink-muted hover:text-ink"
              href={buildMessageLink(props.channelId, props.rootId)}
            >
              {t('calls.openInChannel')}
            </a>
          </div>
          <StaticMarkdownContext>
            <div class="min-w-0 rounded border border-edge-muted/50 py-2">
              <MessageThread
                data={threadListItem(data())}
                canWrite={false}
                expanded
                hideReplyInput
                monorail
                hideRail
                targetId={props.targetId}
                targetRequestKey={props.targetRequestKey}
                onClearTarget={props.onClearTarget}
                buildLink={(message) =>
                  buildMessageLink(
                    props.channelId,
                    message.id,
                    message.thread_id
                  )
                }
              />
            </div>
          </StaticMarkdownContext>
        </section>
      )}
    </Show>
  );
}

/** The one place a call's record chooses how to show its discussion. */
export function CallDiscussionHistory(
  props: CallChatHistoryProps & { discussion: CallDiscussion }
) {
  const channelThread = () =>
    props.discussion.kind === 'channel_thread' ? props.discussion : undefined;

  return (
    <Show
      when={channelThread()}
      keyed
      fallback={<CallChatHistory {...props} />}
    >
      {(thread) => (
        <Suspense>
          <ChannelThreadHistory
            channelId={thread.channel_id}
            rootId={thread.root_id}
            targetId={props.targetId}
            targetRequestKey={props.targetRequestKey}
            onClearTarget={props.onClearTarget}
            render={props.render}
          />
        </Suspense>
      )}
    </Show>
  );
}

function CallChatHistoryContent(props: CallChatHistoryProps) {
  const chat = useCallChat(() => props.callId);
  if (props.render) return props.render(chat);
  return (
    <StaticMarkdownContext>
      <Show when={chat.loading()}>
        <p role="status" class="text-sm text-ink-muted">
          Loading chat…
        </p>
      </Show>
      <Show when={chat.empty()}>
        <p class="text-sm text-ink-muted">
          No messages were sent during this call.
        </p>
      </Show>
      <Show when={chat.failed()}>
        <div>
          <p role="alert" class="text-sm text-ink-muted">
            Could not load chat.
          </p>
          <button
            type="button"
            class="mt-2 text-sm text-accent"
            onClick={() => fireAndForget(chat.refresh(), 'channel-call')}
          >
            Retry
          </button>
        </div>
      </Show>
      <Show when={chat.thread()}>
        {(thread) => (
          <div class="min-w-0 rounded border border-edge-muted/50 py-2">
            <MessageThread
              data={threadListItem(thread())}
              canWrite={false}
              expanded
              hideReplyInput
              monorail
              hideRail
              targetId={props.targetId}
              targetRequestKey={props.targetRequestKey}
              onClearTarget={props.onClearTarget}
              buildLink={(message) =>
                buildCallMessageLink(props.callId, message.id)
              }
            />
          </div>
        )}
      </Show>
    </StaticMarkdownContext>
  );
}
