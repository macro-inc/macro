import { type Accessor, createContext, useContext } from 'solid-js';

/**
 * A view kept mounted while hidden: a parked pane on phones. `hidden` views
 * must not act as if seen (Back handlers, reads); `suspended` ones also hold
 * their query results and apply the latest once shown. Both are false outside
 * a provider.
 */
export type PaneVisibility = {
  hidden: Accessor<boolean>;
  suspended: Accessor<boolean>;
};

const SHOWN: PaneVisibility = {
  hidden: () => false,
  suspended: () => false,
};

export const PaneVisibilityContext = createContext<PaneVisibility>(SHOWN);

export function usePaneHidden(): Accessor<boolean> {
  return useContext(PaneVisibilityContext).hidden;
}

export function usePaneSuspended(): Accessor<boolean> {
  return useContext(PaneVisibilityContext).suspended;
}
