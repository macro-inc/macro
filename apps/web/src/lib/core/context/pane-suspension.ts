import { type Accessor, createContext, useContext } from 'solid-js';

/**
 * Whether the view under it is hidden and should hold its updates: a parked
 * pane on phones, when hidden views are suspended. Queries keep their latest
 * result and apply it once the view shows again. False outside a provider.
 */
export const PaneSuspensionContext = createContext<Accessor<boolean>>(
  () => false
);

export function usePaneSuspended(): Accessor<boolean> {
  return useContext(PaneSuspensionContext);
}
