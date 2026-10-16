/**
 * The tabs at the top of a panel group (Properties and Color), as
 * Photoshop groups its panels. Presentational.
 */

import { cn } from '@ui';
import { For, type JSX } from 'solid-js';

export function PanelTabs<T extends string>(props: {
  tabs: readonly { value: T; label: string; testId?: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Controls at the right of the tabs. */
  actions?: JSX.Element;
}) {
  return (
    <div
      role="tablist"
      class="flex h-8 shrink-0 items-end gap-3 border-edge-muted border-b px-3"
    >
      <For each={props.tabs}>
        {(tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.value === tab.value}
            data-testid={tab.testId}
            class={cn(
              '-mb-px border-b-2 pb-1.5 font-semibold text-xs',
              props.value === tab.value
                ? 'border-accent text-ink'
                : 'border-transparent text-ink-muted hover:text-ink'
            )}
            onClick={() => props.onChange(tab.value)}
          >
            {tab.label}
          </button>
        )}
      </For>
      <span class="flex-1" />
      <div class="flex items-center self-center">{props.actions}</div>
    </div>
  );
}
