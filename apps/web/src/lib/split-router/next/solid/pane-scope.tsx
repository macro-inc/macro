import { type ParentProps, useContext } from 'solid-js';
import type { PaneId } from '../routes/types';
import { PaneContext, type PaneContextValue, useSplitRouter } from './context';

/**
 * Makes `pane` the one that nested outlets render and hooks act on. A panel
 * wraps its chrome and its `<Outlet />` in one so both can use the hooks.
 * Inside a route, the pane continues below that route's level, so a layout
 * route can render each of its panes; at the root it starts at the top.
 */
export function PaneScope(props: ParentProps<{ pane: PaneId }>) {
  const router = useSplitRouter();
  const enclosing = useContext(PaneContext);

  const context: PaneContextValue = {
    pane: () => props.pane,
    entry: () => router.entry(props.pane),
    depth: () => enclosing?.depth() ?? 0,
  };

  return (
    <PaneContext.Provider value={context}>
      {props.children}
    </PaneContext.Provider>
  );
}
