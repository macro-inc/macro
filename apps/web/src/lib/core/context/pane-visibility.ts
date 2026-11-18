import { type Accessor, createContext, useContext } from 'solid-js';

/**
 * Whether the view is kept mounted while hidden: a parked pane on phones. A
 * hidden view must not act as if seen (Back handlers, reads), and it holds
 * its query results, applying the latest once shown. False outside a
 * provider.
 */
export const PaneHiddenContext = createContext<Accessor<boolean>>(() => false);

export function usePaneHidden(): Accessor<boolean> {
  return useContext(PaneHiddenContext);
}
