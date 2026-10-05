import type { ListView } from '@app/constants/list-views';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSettingsState } from '@core/constant/SettingsState';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
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
 * Navigate to a nav view from the pill row. Native mobile stacks panes, and
 * the stack resets to just that view: nav views never show a back button,
 * so nothing may sit behind them.
 * Otherwise switching between nav views replaces in place (mergeHistory), and
 * from an entity it navigates forward. Settings toggles the settings split.
 */
export function useMobileNavNavigate(): (id: MobileDockNavId) => void {
  const { openWithSplit, replaceAllSplits } = useSplitLayout();
  const { toggleSettings } = useSettingsState();

  return (id) => {
    if (id === 'settings') {
      toggleSettings();
      return;
    }
    const content = mobileNavContent(id);
    if (isNativeMobilePlatform()) {
      replaceAllSplits(content);
      return;
    }
    const fgContent = globalSplitManager()?.activeSplit()?.content();
    const isOnNavView = fgContent?.type === 'component';
    openWithSplit(content, { mergeHistory: isOnNavView });
  };
}
