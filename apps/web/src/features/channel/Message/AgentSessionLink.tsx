import { useSplitLayout } from '@components/app/split-layout/layout';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
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
 * `agent-session-link`.
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
        <Show
          when={compact}
          fallback={
            <button
              type="button"
              class={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full',
                'bg-surface px-2 py-0.5 text-xs leading-none text-ink-muted',
                'transition-colors hover:bg-hover hover:text-ink',
                props.class
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
            class={cn('bg-transparent font-normal', props.class)}
            aria-label="Open session"
            title="Open the agent session this message came from"
            onClick={(event: MouseEvent) => open(link().sessionId, event)}
          >
            <ArrowUpRightIcon class="size-3" aria-hidden="true" />
          </Button>
        </Show>
      )}
    </Show>
  );
}
