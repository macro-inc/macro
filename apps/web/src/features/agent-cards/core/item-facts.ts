import { fireAndForget } from '@core/util/fireAndForget';
import { invalidatePreview } from '@queries/preview';
import {
  type Accessor,
  createContext,
  createEffect,
  untrack,
  useContext,
} from 'solid-js';
import { type ItemFact, stepItem } from './run-cards';

const NONE: ReadonlyMap<string, ItemFact> = new Map();

/**
 * What the reply a view sits in did to each item, by `itemKey`, so a card
 * the view shows for one of them says it: `Created`, `Sent`. The facts come
 * from the steps that did it, never from the view the model wrote. Outside
 * an agent's reply there are none.
 */
export const ItemFacts = createContext<() => ReadonlyMap<string, ItemFact>>(
  () => NONE
);

/** The facts of the reply this component sits in. */
export function useItemFacts(): () => ReadonlyMap<string, ItemFact> {
  return useContext(ItemFacts);
}

/**
 * Loads again each item a live reply's step changes, once the step is done:
 * a card or chip already on the page still holds the item as it was, under
 * its old name. Steps finished before the reply mounted are history, and
 * their items load fresh with it.
 */
export function refreshChangedItems(
  rows: Accessor<readonly { id: string; card?: unknown }[]>
) {
  const done = new Set(
    untrack(rows)
      .filter((row) => stepItem(row.card))
      .map((row) => row.id)
  );
  createEffect(() => {
    for (const row of rows()) {
      const fact = done.has(row.id) ? undefined : stepItem(row.card);
      if (!fact) continue;
      done.add(row.id);
      fireAndForget(invalidatePreview(fact.item.id), 'agent-reply-item');
    }
  });
}
