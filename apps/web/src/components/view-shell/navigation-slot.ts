import { type Accessor, createContext } from 'solid-js';

/** Optional host for the active workspace's navigation control. */
export const ViewNavigationSlotContext =
  createContext<Accessor<HTMLElement | undefined>>();
