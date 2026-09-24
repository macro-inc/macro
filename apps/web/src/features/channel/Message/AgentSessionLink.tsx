import { useSplitLayout } from '@components/app/split-layout/layout';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { splitMessageContent } from './agent-session-link';
import { useMessage } from './context';

type AgentSessionLinkProps = {
  class?: string;
};

/**
 * A quiet "View agent session" link on the sender line of a message an
 * agent posted from a session, opening that session. Rendered only when the
 * message leads with the harness's session node; see `agent-session-link`.
 */
export function AgentSessionLink(props: AgentSessionLinkProps) {
  const message = useMessage();
  const layout = useSplitLayout();
  const link = () => splitMessageContent(message()).link;

  return (
    <Show when={link()}>
      {(link) => (
        <button
          type="button"
          class={cn(
            'shrink-0 text-xs leading-none text-ink-muted hover:text-ink hover:underline',
            props.class
          )}
          title="Open the agent session this message came from"
          onClick={(event) => {
            event.stopPropagation();
            layout?.openWithSplit(
              { type: 'agent', id: link().sessionId },
              { activate: true, preferNewSplit: event.shiftKey }
            );
          }}
        >
          View agent session
        </button>
      )}
    </Show>
  );
}
