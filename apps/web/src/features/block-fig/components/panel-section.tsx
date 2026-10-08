/** A titled section of the design panel, with optional "+" and "−". */

import Minus from '@phosphor/minus.svg';
import Plus from '@phosphor/plus.svg';
import { type JSX, Show } from 'solid-js';

export function Section(props: {
  title: string;
  children: JSX.Element;
  /** A "+" action in the header (add a fill, say). */
  onAdd?: () => void;
  addLabel?: string;
  /** A "−" action in the header (remove auto layout, say). */
  onRemove?: () => void;
  /** More header controls, before "+" (a style picker, say). */
  actions?: JSX.Element;
  testId?: string;
}) {
  return (
    <section
      class="fig-inspector-section border-edge-frame border-b px-4 py-2"
      data-testid={props.testId}
    >
      <div class="flex h-6 items-center justify-between gap-1">
        <h3 class="mr-auto font-medium text-ink text-xs">{props.title}</h3>
        {props.actions}
        <Show when={props.onAdd}>
          {(add) => (
            <button
              type="button"
              aria-label={props.addLabel ?? `Add ${props.title.toLowerCase()}`}
              class="flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => add()()}
            >
              <Plus class="size-3.5" />
            </button>
          )}
        </Show>
        <Show when={props.onRemove}>
          {(remove) => (
            <button
              type="button"
              aria-label={`Remove ${props.title.toLowerCase()}`}
              class="flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => remove()()}
            >
              <Minus class="size-3.5" />
            </button>
          )}
        </Show>
      </div>
      <div class="fig-inspector-section-body flex flex-col gap-2">
        {props.children}
      </div>
    </section>
  );
}
