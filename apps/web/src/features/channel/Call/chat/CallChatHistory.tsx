import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { MessageThread, threadListItem } from '@core/messages/MessageThread';
import { Show, Suspense } from 'solid-js';
import { buildCallMessageLink } from './build-call-message-link';
import { useCallChat } from './queries/use-call-chat';

type CallChatHistoryProps = {
  callId: string;
  targetId?: string;
  onClearTarget?: () => void;
};

/** Saved call chat shares the live thread cache and read-only message controls. */
export function CallChatHistory(props: CallChatHistoryProps) {
  return (
    <section class="flex min-w-0 flex-col gap-3" aria-label="Call chat">
      <h3 class="text-sm font-semibold text-ink">Call chat</h3>
      <Suspense fallback={<p class="text-sm text-ink-muted">Loading chat…</p>}>
        <CallChatHistoryContent {...props} />
      </Suspense>
    </section>
  );
}

function CallChatHistoryContent(props: CallChatHistoryProps) {
  const chat = useCallChat(() => props.callId);
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
            onClick={() => void chat.refresh()}
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
              targetId={props.targetId}
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
