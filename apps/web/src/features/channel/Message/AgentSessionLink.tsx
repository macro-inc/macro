import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import BellIcon from '@icon/system/regular/bell.svg';
import BellSlashIcon from '@icon/system/regular/bell-slash.svg';
import {
  useSessionThreadRepliesQuery,
  useSetSessionThreadRepliesMutation,
} from '@queries/agent-session/thread-replies';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { splitMessageContent } from './agent-session-link';
import { useCollapseLongContent, useMessage } from './context';

type AgentSessionLinkProps = {
  class?: string;
};

/**
 * A quiet "Open Session" chip on the sender line of a message an agent
 * posted from a session, opening that session in its own split. Rendered
 * only when the message leads with the harness's session node; see
 * `agent-session-link`. Beside it, a toggle pauses the agent's unmentioned
 * replies in the thread (`ThreadRepliesToggle`).
 */
export function AgentSessionLink(props: AgentSessionLinkProps) {
  const message = useMessage();
  const layout = useSplitLayout();
  // Comment cards are the narrow host. The labeled chip takes a line of its
  // own there; the agent card's icon button fits the sender line.
  const compact = useCollapseLongContent();
  const link = () => splitMessageContent(message()).link;

  const open = (sessionId: string, event: MouseEvent) => {
    event.stopPropagation();
    layout?.openWithSplit(
      { type: 'agent', id: sessionId },
      { activate: true, preferNewSplit: true }
    );
  };

  return (
    <Show when={link()}>
      {(link) => (
        <span
          class={cn('inline-flex shrink-0 items-center gap-1', props.class)}
        >
          <ThreadRepliesToggle sessionId={link().sessionId} compact={compact} />
          <Show
            when={compact}
            fallback={
              <button
                type="button"
                class={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full',
                  'bg-surface px-2 py-0.5 text-xs leading-none text-ink-muted',
                  'transition-colors hover:bg-hover hover:text-ink'
                )}
                title="Open the agent session this message came from"
                onClick={(event) => open(link().sessionId, event)}
              >
                Open Session
                <ArrowUpRightIcon class="size-3" aria-hidden="true" />
              </button>
            }
          >
            <Button
              variant="secondary"
              size="icon-sm"
              class="bg-transparent font-normal"
              aria-label="Open session"
              title="Open the agent session this message came from"
              onClick={(event: MouseEvent) => open(link().sessionId, event)}
            >
              <ArrowUpRightIcon class="size-3" aria-hidden="true" />
            </Button>
          </Show>
        </span>
      )}
    </Show>
  );
}

/**
 * Turns the agent's replies in this thread off and on. While off, the agent
 * answers only messages that mention it. Shown only for a session started
 * from a thread, to someone who may edit it.
 */
function ThreadRepliesToggle(props: { sessionId: string; compact: boolean }) {
  const replies = useSessionThreadRepliesQuery(() => props.sessionId);
  const setReplies = useSetSessionThreadRepliesMutation();
  // Gate every data read on success: a pending read would suspend the message.
  const state = () => (replies.isSuccess ? replies.data : undefined);
  const paused = () => state()?.paused ?? false;

  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    const next = !paused();
    setReplies.mutate(
      { sessionId: props.sessionId, paused: next },
      {
        onError: () =>
          toast.failure(
            next
              ? t('agentThreadReplies.pauseFailed')
              : t('agentThreadReplies.resumeFailed')
          ),
      }
    );
  };

  return (
    <Show when={state()?.fromThread && state()?.canChange}>
      <Button
        variant="secondary"
        size="icon-sm"
        class={cn(
          'bg-transparent font-normal',
          !props.compact && 'size-5 rounded-full',
          paused() ? 'text-ink' : 'text-ink-muted'
        )}
        aria-label={
          paused()
            ? t('agentThreadReplies.resume')
            : t('agentThreadReplies.pause')
        }
        aria-pressed={paused()}
        title={
          paused()
            ? t('agentThreadReplies.resumeHint')
            : t('agentThreadReplies.pauseHint')
        }
        disabled={setReplies.isPending}
        onClick={toggle}
      >
        <Show
          when={paused()}
          fallback={<BellIcon class="size-3" aria-hidden="true" />}
        >
          <BellSlashIcon class="size-3" aria-hidden="true" />
        </Show>
      </Button>
    </Show>
  );
}
