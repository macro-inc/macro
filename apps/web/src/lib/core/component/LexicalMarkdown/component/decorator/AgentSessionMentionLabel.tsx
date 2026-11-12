import { agentSessionMark } from '@core/component/agentSessionMark';
import { Dynamic } from 'solid-js/web';

/**
 * A session reference uses the same underline treatment as other mentions,
 * with the brand mark of the agent running it (Claude, Codex, Cursor, Macro).
 */
export function AgentSessionMentionLabel(props: {
  label: string;
  harness?: string | null;
  botId?: string | null;
}) {
  const mark = () =>
    agentSessionMark({ harness: props.harness, botId: props.botId });
  return (
    <span class="pointer-events-auto">
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-1">
        <Dynamic
          component={mark().Icon}
          class={`size-full ${mark().class}`}
          aria-hidden="true"
        />
      </span>
      <span class="text-ink underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        {props.label}
      </span>
    </span>
  );
}
