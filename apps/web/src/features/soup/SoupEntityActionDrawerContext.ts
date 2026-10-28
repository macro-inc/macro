import type {
  EntityActionListState,
  EntityActionNavigationHandler,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import type { MarkDoneDelegate } from '@app/features/next-soup/actions/mark-done-delegate';
import type { EntityData } from '@entity';
import { type Accessor, createContext, useContext } from 'solid-js';

export type EntityActionDrawerEntry = {
  entity: EntityData;
  list: EntityActionListState;
  viewContext: EntityActionViewContext;
  markDoneDelegate?: () => MarkDoneDelegate | undefined;
  createActionNavigationHandler?: () =>
    | EntityActionNavigationHandler
    | undefined;
  viewedProjectId?: string;
};

export type SoupEntityActionDrawerState = {
  isOpen: Accessor<boolean>;
  entry: Accessor<EntityActionDrawerEntry | undefined>;
  open: (entry: EntityActionDrawerEntry) => void;
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
