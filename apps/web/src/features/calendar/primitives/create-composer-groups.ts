import { createStore } from 'solid-js/store';

export type ComposerGroup = 'date' | 'guests' | 'calendar';

/** Each composer mount owns its own one-way disclosure state. */
export function createComposerGroups() {
  const [open, setOpen] = createStore<Record<ComposerGroup, boolean>>({
    date: false,
    guests: false,
    calendar: false,
  });
  return {
    isOpen: (group: ComposerGroup) => open[group],
    open: (group: ComposerGroup) => setOpen(group, true),
  };
}
