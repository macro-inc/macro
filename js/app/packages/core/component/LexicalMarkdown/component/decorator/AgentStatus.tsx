import type { AgentStatusDecoratorProps } from '@lexical-core';

/**
 * Renders an agent's transient "working" status as pulsing accent text, used
 * for Macro Agent's initial "thinking" message before it edits in the answer.
 */
export function AgentStatus(props: AgentStatusDecoratorProps) {
  return (
    <span
      class="inline-flex items-center text-ink-muted animate-pulse"
      aria-live="polite"
    >
      {props.statusText}
    </span>
  );
}
