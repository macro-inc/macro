import type { SplitId } from '@app/component/split-layout/layoutManager';
import { type Accessor, createSignal } from 'solid-js';

type InboxFilterController = {
  /** `undefined` = all inboxes; otherwise the selected email link ids. */
  inboxFilter: Accessor<string[] | undefined>;
  setInboxFilter: (ids: string[] | undefined) => void;
};

/**
 * Entry-state key the mail view persists its inbox filter under. Exposed so
 * out-of-tree consumers (the sidebar) can read the filter a mail history
 * entry captured on nav-away — e.g. while an email block is open on top.
 */
export const INBOX_FILTER_ENTRY_KEY = 'soup.inboxFilter';

// Signal-of-Map (with equals: false) so consumers outside the split tree —
// the sidebar's nested account rows — re-render on register/unregister.
const [controllers, setControllers] = createSignal(
  new Map<SplitId, InboxFilterController>(),
  { equals: false }
);
const pendingFilterBySplit = new Map<SplitId, string[] | undefined>();

export function registerInboxFilterSplit(
  splitId: SplitId,
  controller: InboxFilterController
): () => void {
  setControllers((map) => map.set(splitId, controller));
  if (pendingFilterBySplit.has(splitId)) {
    controller.setInboxFilter(pendingFilterBySplit.get(splitId));
    pendingFilterBySplit.delete(splitId);
  }
  return () => {
    setControllers((map) => {
      if (map.get(splitId) === controller) map.delete(splitId);
      return map;
    });
  };
}

/** Reactive: tracks registration changes and re-evaluates for callers. */
export function getInboxFilterSplit(
  splitId: SplitId
): InboxFilterController | undefined {
  return controllers().get(splitId);
}

/**
 * Set the inbox filter for the given split. If the split's mail view is
 * already mounted, apply immediately; otherwise queue the value and apply it
 * once the view registers (e.g. right after a sidebar navigation).
 */
export function requestInboxFilter(
  splitId: SplitId,
  ids: string[] | undefined
) {
  const controller = controllers().get(splitId);
  if (controller) {
    controller.setInboxFilter(ids);
    return;
  }
  pendingFilterBySplit.set(splitId, ids);
}
