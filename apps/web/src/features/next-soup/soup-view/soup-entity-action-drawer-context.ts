import type { EntityData } from '@entity';
import { type Accessor, createContext, useContext } from 'solid-js';
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
