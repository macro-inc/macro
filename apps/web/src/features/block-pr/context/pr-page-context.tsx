import type { ChangesSource } from '@app/features/changes/context/changes-context';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { PrPageActions } from './pr-page-actions';
import type { PrPageReadModel } from './pr-page-read-model';

export type PrPageContext = {
  page: Accessor<PrPageReadModel | undefined>;
  actions: PrPageActions;
  changesSource: ChangesSource;
  /** Read lifecycle, independent of optional linked metadata. */
  status?: Accessor<'pending' | 'error' | 'success'>;
  retry?: () => void;
};

const PrPageContextValue = createContext<PrPageContext>();

/** The route owns the adapters; descendants consume only this contract. */
export function PrPageProvider(props: ParentProps<{ value: PrPageContext }>) {
  return (
    <PrPageContextValue.Provider value={props.value}>
      {props.children}
    </PrPageContextValue.Provider>
  );
}

export function usePrPage(): PrPageContext {
  const value = useContext(PrPageContextValue);
  if (!value) throw new Error('PrPageProvider is required');
  return value;
}

export function usePrPageRead(): Accessor<PrPageReadModel | undefined> {
  return usePrPage().page;
}

export function usePrPageActions(): PrPageActions {
  return usePrPage().actions;
}
