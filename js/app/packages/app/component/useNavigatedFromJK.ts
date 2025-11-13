import { createMemo } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

export function useNavigatedFromJK() {
  const {
    unifiedListContext: {
      entitiesSignal: [_entities],
    },
  } = useSplitPanelOrThrow();
  const navigatedFromJK = createMemo(() => {
    const entities = _entities();
    if (!entities) return false;
    return (
      entities.length > 0 &&
      document.documentElement.getAttribute('data-modality') === 'keyboard'
    );
  });
  return { navigatedFromJK };
}
