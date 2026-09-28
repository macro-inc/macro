import type { ListView } from '@app/constants/list-views';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSettingsState } from '@core/constant/SettingsState';
import { type Accessor, createMemo } from 'solid-js';
import { useSplitLayout } from '../split-layout/layout';
import { isMobileNavViewId, type MobileNavViewId } from './mobile-nav-views';

/**
 * Everything the dock can navigate to: the pill-row views plus the list views
 * only reachable through the Views menu or the dynamic nav button (folders,
 * companies, …).
 */
export type MobileDockNavId = ListView | 'calendar' | 'settings';

function mobileNavContent(id: Exclude<MobileDockNavId, 'settings'>) {
  return {
    type: 'component' as const,
    id: id === 'calendar' ? CALENDAR_VIEW_ID : id,
  };
}

/** The mobile navigation view represented by the foreground split content. */
export function useForegroundMobileView(): Accessor<
  MobileNavViewId | undefined
> {
  return createMemo(() => {
    const content = globalSplitManager()?.activeSplit()?.content();
    if (!content) return undefined;
    if (content.type !== 'component') return undefined;
    return isMobileNavViewId(content.id) ? content.id : undefined;
  });
}

/**
 * Navigate to a nav view from the pill row. Same semantics as the old dock
 * buttons: switching between navigation views replaces in-place (mergeHistory)
 * so the switch doesn't push a swipe-back entry; from an entity it is forward
 * navigation so the user can swipe back. Settings toggles the settings split.
 */
export function useMobileNavNavigate(): (id: MobileDockNavId) => void {
  const { openWithSplit } = useSplitLayout();
  const { toggleSettings } = useSettingsState();

  return (id) => {
    if (id === 'settings') {
      toggleSettings();
      return;
    }
    const fgContent = globalSplitManager()?.activeSplit()?.content();
    const isOnNavView = fgContent?.type === 'component';
    openWithSplit(mobileNavContent(id), { mergeHistory: isOnNavView });
  };
}
