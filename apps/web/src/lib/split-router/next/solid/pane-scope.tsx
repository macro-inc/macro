import type { ParentProps } from 'solid-js';
import type { PaneId } from '../routes/types';
import { PaneContext, type PaneContextValue, useSplitRouter } from './context';

/**
 * Makes `pane` the one that nested outlets render and hooks act on. A panel
 * wraps its chrome and its `<Outlet />` in one so both can use the hooks.
 */
export function PaneScope(props: ParentProps<{ pane: PaneId }>) {
  const router = useSplitRouter();

  const context: PaneContextValue = {
    pane: () => props.pane,
    entry: () => router.entry(props.pane),
    depth: () => 0,
  };

  return (
    <PaneContext.Provider value={context}>
      {props.children}
    </PaneContext.Provider>
  );
}
