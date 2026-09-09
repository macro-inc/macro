import { type Accessor, createContext, onCleanup, useContext } from 'solid-js';

/** Only main content can identify the owner; reference blocks cannot change it. */
export const RightPanelOwnerContext =
  createContext<(owner: Accessor<string>) => VoidFunction>();

export function useRightPanelOwner(owner: Accessor<string>) {
  const register = useContext(RightPanelOwnerContext);
  if (register) onCleanup(register(owner));
}
