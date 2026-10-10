import { ItemCard } from '@app/features/agent-cards/components/item-card';
import { For, Show } from 'solid-js';
import type { WidgetOf } from '../schema';
import { TEXT } from '../tokens';

export type CardsProps = Omit<WidgetOf<'cards'>, 'type'>;

/** More than this reads as a list; the rest are left to a list widget. */
const MAX_CARDS = 6;

/** The few specific items an answer is about, one card each. */
export function Cards(props: CardsProps) {
  return (
    <section class="flex min-w-0 flex-col gap-2">
      <Show when={props.title}>
        {(title) => (
          <h3 class={`text-sm font-semibold ${TEXT.primary}`}>{title()}</h3>
        )}
      </Show>
      <div class="flex min-w-0 flex-col gap-2">
        <For each={props.items.slice(0, MAX_CARDS)}>
          {(item) => <ItemCard item={{ type: item.type, id: item.id }} />}
        </For>
      </div>
    </section>
  );
}
