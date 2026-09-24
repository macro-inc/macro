import type { AgentContextDecoratorProps } from '@macro-inc/lexical-core';
import CaretRight from '@phosphor/caret-right.svg';
import type { Component } from 'solid-js';

/**
 * A quiet disclosure for the channel context supplied to an agent. Borderless
 * caret-and-label row, matching the agent transcript's own disclosures
 * (`Thought`, `ToolGroup`), so the prompt it precedes stays the loudest thing
 * in the bubble.
 */
export const AgentContext: Component<AgentContextDecoratorProps> = (props) => (
  <details class="group my-1 text-xs leading-5">
    <summary class="flex w-fit list-none select-none items-center gap-1 text-ink-subtle transition-colors hover:text-ink-muted [&::-webkit-details-marker]:hidden">
      <CaretRight
        aria-hidden="true"
        class="size-3.5 shrink-0 transition-transform group-open:rotate-90"
      />
      Context
    </summary>
    <div class="mt-1 ml-1.5 max-h-64 overflow-auto border-l border-edge pl-2.5 whitespace-pre-wrap text-ink-muted">
      {props.text}
    </div>
  </details>
);
