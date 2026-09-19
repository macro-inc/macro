import { isListViewID } from '@app/constants/list-views';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';

export function useIsInboxView() {
  const panel = useSplitPanelOrThrow();

  const currentView = () => {
    const { type, id } = panel.handle.content();
    if (type !== 'component') return;
    return isListViewID(id) ? id : undefined;
  };

  return () => currentView() === 'inbox';
}
