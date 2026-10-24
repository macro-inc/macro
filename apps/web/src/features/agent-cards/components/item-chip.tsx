import { ItemPreview } from '@core/component/ItemPreview';
import { Show } from 'solid-js';
import type { ItemFact } from '../core/run-cards';
import { PREVIEW_TYPES } from './reference-card';

/**
 * The item a step created, changed or sent, named on the step's row the way
 * a mention names it, and opening it the same way. The agent shows what the
 * reply is about; the row is where every item it touched can still be found.
 * An event has no preview to load, so its row names it as the step knew it.
 */
export function ItemChip(props: { fact: ItemFact }) {
  const loadable = () => {
    const { type, id } = props.fact.item;
    return type === 'calendar_event' ? undefined : { type, id };
  };
  return (
    <Show
      when={loadable()}
      fallback={
        <Show when={props.fact.title}>
          {(title) => (
            <span class="min-w-0 truncate text-ink-muted">{title()}</span>
          )}
        </Show>
      }
    >
      {(item) => (
        <ItemPreview
          class="inline-flex min-w-0 align-middle ring-0"
          id={item().id}
          type={PREVIEW_TYPES[item().type]}
        />
      )}
    </Show>
  );
}
