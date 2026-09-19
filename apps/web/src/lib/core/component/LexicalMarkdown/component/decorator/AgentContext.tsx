import type { AgentContextDecoratorProps } from '@macro-inc/lexical-core';
import type { Component } from 'solid-js';

/** A quiet disclosure for the channel context supplied to an agent. */
export const AgentContext: Component<AgentContextDecoratorProps> = (props) => (
  <details class="my-1 text-xs text-ink-muted">
    <summary class="w-fit select-none rounded-full border border-edge-muted bg-hover px-2 py-0.5">
      Context
    </summary>
    <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-edge-muted bg-hover p-2 font-sans text-xs text-ink-muted">
      {props.text}
    </pre>
  </details>
);
