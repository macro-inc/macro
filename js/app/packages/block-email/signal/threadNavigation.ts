import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { createMemo } from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';

export function useThreadNavigation() {
  const {
    unifiedListContext: {
      entitiesSignal: [entities],
      setSelectedViewStore,
    },
  } = useSplitPanelOrThrow();
  const { replaceOrInsertSplit } = useSplitLayout();
  const blockId = useBlockId();

  const emailsEntities = createMemo(
    () => entities()?.filter(({ type }) => type === 'email') ?? []
  );

  const currentIndex = createMemo(() =>
    emailsEntities().findIndex((m) => m.id === blockId)
  );

  const navigateThread = (direction: 'up' | 'down'): boolean => {
    const currIndex = currentIndex();
    if (currIndex < 0) return false;

    if (
      (currIndex === 0 && direction === 'up') ||
      (currIndex === emailsEntities().length - 1 && direction === 'down')
    ) {
      return false;
    }

    const newIndex = currIndex + (direction === 'down' ? 1 : -1);
    const email = emailsEntities().at(newIndex);

    if (!email) return false;

    setSelectedViewStore('selectedEntity', email);
    replaceOrInsertSplit({ type: 'email', id: email.id });

    return true;
  };

  return {
    currentIndex,
    emailsEntities,
    navigateThread,
  };
}
