import { createContext, useContext, type Accessor } from 'solid-js';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';

export type SoupEntityActionDrawerState = {
  isOpen: Accessor<boolean>;
  entity: Accessor<EntityData | undefined>;
  soup: Accessor<SoupState | undefined>;
  open: (entity: EntityData, soup: SoupState) => void;
  close: () => void;
};

const SoupEntityActionDrawerContext =
  createContext<SoupEntityActionDrawerState>();

export const SoupEntityActionDrawerContextProvider =
  SoupEntityActionDrawerContext.Provider;

export function useSoupEntityActionDrawer():
  | SoupEntityActionDrawerState
  | undefined {
  return useContext(SoupEntityActionDrawerContext);
}
