import { globalSplitManager } from '@app/signal/splitLayout';
import { useSettingsState } from '@core/constant/SettingsState';
import { type Accessor, createMemo } from 'solid-js';
import { useSplitLayout } from '../split-layout/layout';
import { isMobileNavViewId, type MobileNavViewId } from './mobile-nav-views';

/** The foreground content's id when it is itself a nav view. */
export function useForegroundMobileView(): Accessor<
  MobileNavViewId | undefined
> {
  return createMemo(() => {
    const content = globalSplitManager()?.activeSplit()?.content();
    if (!content || content.type !== 'component') return undefined;
    return isMobileNavViewId(content.id) ? content.id : undefined;
  });
}

/**
 * Navigate to a nav view from the pill row. Same semantics as the old dock
 * buttons: switching between component views replaces in-place (mergeHistory)
 * so the switch doesn't push a swipe-back entry; from an entity it is forward
 * navigation so the user can swipe back. Settings toggles the settings split.
 */
export function useMobileNavNavigate(): (id: MobileNavViewId) => void {
  const { openWithSplit } = useSplitLayout();
  const { toggleSettings } = useSettingsState();

  return (id) => {
    if (id === 'settings') {
      toggleSettings();
      return;
    }
    const fgContent = globalSplitManager()?.activeSplit()?.content();
    const isOnComponentView = fgContent?.type === 'component';
    openWithSplit(
      { type: 'component', id },
      { mergeHistory: isOnComponentView }
    );
  };
}
