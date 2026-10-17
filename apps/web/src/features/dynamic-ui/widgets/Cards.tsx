import { ItemCard } from '@app/features/agent-cards/components/item-card';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import type { WidgetOf } from '../schema';

export type CardsProps = Omit<WidgetOf<'cards'>, 'type'>;

/** More than this reads as a list; the rest are left to a list widget. */
const MAX_CARDS = 6;

/** Up to this many cards stack; more sit side by side where there is room. */
const STACKED_CARDS = 3;

/**
 * The few specific items an answer is about, one card each. One to three
 * stack; four to six sit in a grid, two across once the message is wide
 * enough. Each is its own card, never boxed together.
 */
export function Cards(props: CardsProps) {
  const items = () => props.items.slice(0, MAX_CARDS);
  return (
    <section
      class="@container flex w-full max-w-2xl min-w-0 flex-col gap-2"
      aria-label={props.title}
    >
      <Show when={props.title}>
        {(title) => <h3 class="text-sm font-semibold text-ink">{title()}</h3>}
      </Show>
      <div
        class={cn(
          'min-w-0 gap-2',
          items().length > STACKED_CARDS
            ? 'grid grid-cols-1 @lg:grid-cols-2'
            : 'flex flex-col'
        )}
      >
        <For each={items()}>
          {(item) => <ItemCard item={{ type: item.type, id: item.id }} />}
        </For>
      </div>
    </section>
  );
}
