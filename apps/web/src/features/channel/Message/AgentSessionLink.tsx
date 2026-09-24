import { useSplitLayout } from '@components/app/split-layout/layout';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { splitMessageContent } from './agent-session-link';
import { useMessage } from './context';

type AgentSessionLinkProps = {
  class?: string;
};

/** What the pill reads as when the harness sent no bot name. */
const GENERIC_LABEL = 'Open Session';

/**
 * A quiet pill on the sender line of a message an agent posted from a
 * session, opening that session in its own split. Named after the bot whose
 * session it is ("Macro Coder", "WolfCoderPro") when the harness sent its
 * name, generically otherwise. Rendered only when the message leads with
 * the harness's session node; see `agent-session-link`.
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
            'inline-flex shrink-0 items-center gap-1 rounded-full',
            'bg-surface px-2 py-0.5 text-xs leading-none text-ink-muted',
            'transition-colors hover:bg-hover hover:text-ink',
            props.class
          )}
          title="Open the agent session this message came from"
          onClick={(event) => {
            event.stopPropagation();
            layout?.openWithSplit(
              { type: 'agent', id: link().sessionId },
              { activate: true, preferNewSplit: true }
            );
          }}
        >
          {link().label ?? GENERIC_LABEL}
          <ArrowUpRightIcon class="size-3" aria-hidden="true" />
        </button>
      )}
    </Show>
  );
}
