import {
  createListController,
  createStaticListDataSource,
  type ListDataSource,
} from '@app/components/list';
import {
  type Accessor,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
} from 'solid-js';
import type {
  SetSplitList,
  SplitListActivationMetadata,
  SplitListBinding,
  SplitListRegistration,
  SplitListRow,
} from './context';

export type UseSplitListResult = {
  list: Accessor<SplitListBinding>;
  setList: SetSplitList;
};

export function useSplitList(): UseSplitListResult {
  const splitOwner = getOwner();
  if (!splitOwner) {
    throw new Error('useSplitList requires a Solid owner');
  }

  const emptyDataSource = createStaticListDataSource<SplitListRow>(() => []);
  const emptyController = createListController<
    SplitListRow,
    SplitListActivationMetadata
  >({
    items: emptyDataSource.items,
    getKey: (row) => row.id,
  });
  const [list, setListBinding] = createSignal<SplitListBinding>({
    viewId: undefined,
    dataSource: emptyDataSource,
    controller: emptyController,
  });

  let disposeListRoot: (() => void) | undefined;

  function setList<TDataSource extends ListDataSource<SplitListRow>>(
    factory: () => SplitListRegistration<TDataSource>
  ): SplitListRegistration<TDataSource> {
    let disposeNextRoot: (() => void) | undefined;
    let nextRegistration: SplitListRegistration<TDataSource>;

    try {
      nextRegistration = createRoot((dispose) => {
        disposeNextRoot = dispose;
        return factory();
      }, splitOwner);
    } catch (error) {
      disposeNextRoot?.();
      throw error;
    }

    if (!disposeNextRoot) {
      throw new Error('Split list root did not provide a disposer');
    }

    const disposePreviousRoot = disposeListRoot;

    disposeListRoot = disposeNextRoot;
    setListBinding(nextRegistration);

    disposePreviousRoot?.();

    return nextRegistration;
  }

  onCleanup(() => disposeListRoot?.());

  return { list, setList };
}
