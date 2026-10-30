import { For, type JSX, Show } from 'solid-js';

export type NotificationStackProps<T> = {
  /** Accessible name for the stack region. */
  label: string;
  /** Header content shown above the stack, e.g. a count of pending items. */
  title: JSX.Element;
  items: readonly T[];
  /** Stable identity; keys the card across reorders and removals. */
  itemKey: (item: T) => string;
  /** Renders one card's content. The stack draws the card surface. */
  children: (item: T) => JSX.Element;
};

/**
 * Cards that rest as a stack, the newest in front, and unstack into a list.
 * @do Use for a short queue of independent items that each need attention.
 * @do Keep each card self-contained: its actions act on that item only.
 */
export function NotificationStack<T>(props: NotificationStackProps<T>) {
  return (
    <Show when={props.items.length > 0}>
      <section aria-label={props.label} class="flex flex-col gap-2">
        <div class="flex h-7 items-center gap-2 px-2 text-sm">
          {props.title}
        </div>
        <div class="flex flex-col gap-2">
          <For each={props.items}>
            {(item) => (
              <article
                data-notification-key={props.itemKey(item)}
                class="rounded-2xl border border-edge-frame bg-panel"
              >
                {props.children(item)}
              </article>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
