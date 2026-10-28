import { Card } from '@ui/components/Card';
import { type JSX, Show } from 'solid-js';

/** The composer owns the front surface; these backs only suggest the deck. */
export function ReviewDeck(props: {
  count: number;
  email: boolean;
  children: JSX.Element;
}) {
  return (
    <div
      class="relative isolate min-w-0"
      classList={{ 'pt-3': props.count > 1 }}
    >
      <Show when={props.count > 2}>
        <Card
          aria-hidden="true"
          variant="filled"
          class="pointer-events-none absolute inset-x-4 top-0 h-16 mobile:inset-x-3"
          classList={{ 'rounded-[26.25px] touch:rounded-lg': props.email }}
        />
      </Show>
      <Show when={props.count > 1}>
        <Card
          aria-hidden="true"
          variant="filled"
          class="pointer-events-none absolute inset-x-2 top-1.5 h-16 mobile:inset-x-1.5"
          classList={{ 'rounded-[26.25px] touch:rounded-lg': props.email }}
        />
      </Show>
      <div class="relative min-w-0">{props.children}</div>
    </div>
  );
}
