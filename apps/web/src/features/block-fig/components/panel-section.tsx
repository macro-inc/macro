/** A titled section of the design panel, with optional "+" and "−". */

import Minus from '@phosphor/minus.svg';
import Plus from '@phosphor/plus.svg';
import { type JSX, Show } from 'solid-js';

export function Section(props: {
  title: string;
  children: JSX.Element;
  /** A "+" action in the header (add a fill, say). */
  onAdd?: () => void;
  /** A "−" action in the header (remove auto layout, say). */
  onRemove?: () => void;
  /** More header controls, before "+" (a style picker, say). */
  actions?: JSX.Element;
  testId?: string;
}) {
  return (
    <section
      class="border-edge-muted border-b px-3 py-3"
      data-testid={props.testId}
    >
      <div class="mb-2 flex items-center justify-between gap-1">
        <h3 class="mr-auto font-semibold text-ink text-xs">{props.title}</h3>
        {props.actions}
        <Show when={props.onAdd}>
          {(add) => (
            <button
              type="button"
              aria-label={`Add ${props.title.toLowerCase()}`}
              class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
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
              class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => remove()()}
            >
              <Minus class="size-3.5" />
            </button>
          )}
        </Show>
      </div>
      <div class="flex flex-col gap-1.5">{props.children}</div>
    </section>
  );
}
