import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';

/**
 * CRM settings shown over a workspace location (a list, pipeline, or record).
 * Any navigation to another location, including browser Back, leaves them.
 */
export function createSettingsPage(location: Accessor<string>) {
  const [isOpen, setOpen] = createSignal(false);
  const current = createMemo(location);
  createEffect(on(current, () => setOpen(false), { defer: true }));
  return {
    isOpen,
    open: () => setOpen(true),
    close: () => setOpen(false),
  };
}
