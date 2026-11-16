import { For, Show } from 'solid-js';

/** Decorative event colors inside a calendar day trigger. */
export function CalendarDayMarkers(props: { colors: readonly string[] }) {
  return (
    <span
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 bottom-0 flex h-1 items-center justify-center gap-0.5"
    >
      <Show
        when={props.colors.length >= 4}
        fallback={
          <For each={props.colors}>
            {(color) => (
              <span
                class="size-1 rounded-full"
                style={{ 'background-color': color }}
              />
            )}
          </For>
        }
      >
        <span class="flex h-1 w-5 overflow-hidden rounded-full">
          <For each={props.colors.slice(0, 4)}>
            {(color) => (
              <span
                class="h-full flex-1"
                style={{ 'background-color': color }}
              />
            )}
          </For>
        </span>
      </Show>
    </span>
  );
}
