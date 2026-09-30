import { createSignal } from 'solid-js';

/** Keep failures in the picker so a rejected write can be retried. */
export function createSnoozeController<Item>(options: {
  items: readonly Item[];
  saveItem: (item: Item, until: string) => Promise<void>;
  onSaved: (until: string, count: number) => void;
  now?: () => number;
}) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [remainingItems, setRemainingItems] = createSignal(options.items);
  const remainingCount = () => remainingItems().length;
  const submit = async (until: Date) => {
    if (pending() || !remainingCount()) return;
    if (
      !Number.isFinite(until.getTime()) ||
      until.getTime() <= (options.now?.() ?? Date.now())
    ) {
      setError('Choose a time in the future.');
      return;
    }
    setPending(true);
    setError(undefined);
    const deadline = until.toISOString();
    const items = remainingItems();
    const results = await Promise.allSettled(
      items.map(async (item) => options.saveItem(item, deadline))
    );
    setRemainingItems(
      items.filter((_, index) => results[index].status === 'rejected')
    );
    setPending(false);
    if (remainingCount()) {
      const saved = options.items.length - remainingCount();
      setError(
        saved
          ? `${saved} of ${options.items.length} items snoozed. Choose a time to retry the ${remainingCount()} remaining. Closing keeps saved snoozes.`
          : 'Could not snooze the selected items. Please try again.'
      );
      return;
    }
    options.onSaved(deadline, items.length);
  };
  return { pending, error, remainingCount, submit };
}
