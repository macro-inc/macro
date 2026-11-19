import { type Accessor, createContext } from 'solid-js';

/**
 * A place outside the splits that shows the active split's workspace
 * navigation (the single sidebar). While `active`, a split's `ViewShell`
 * gives up its own navigation column, and the shell in the active split
 * renders its navigation into `slot`.
 */
export type NavigationHost = {
  active: Accessor<boolean>;
  slot: Accessor<HTMLElement | undefined>;
};

export const NavigationHostContext = createContext<NavigationHost>();
