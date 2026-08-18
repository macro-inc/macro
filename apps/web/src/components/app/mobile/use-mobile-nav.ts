import { globalSplitManager } from '@app/signal/splitLayout';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { useSettingsState } from '@core/constant/SettingsState';
import { type Accessor, createMemo } from 'solid-js';
import { useSplitLayout } from '../split-layout/layout';
import { isMobileNavViewId, type MobileNavViewId } from './mobile-nav-views';

type MobileSplitNavViewId = Exclude<MobileNavViewId, 'settings'>;

function mobileNavContent(id: MobileSplitNavViewId) {
  return id === 'calendar'
    ? ({ type: 'calendar', id: CALENDAR_BLOCK_ID } as const)
    : ({ type: 'component', id } as const);
}

/** The mobile navigation view represented by the foreground split content. */
export function useForegroundMobileView(): Accessor<
  MobileNavViewId | undefined
> {
  return createMemo(() => {
    const content = globalSplitManager()?.activeSplit()?.content();
    if (!content) return undefined;
    if (content.type === 'calendar') {
      return content.id === CALENDAR_BLOCK_ID ? 'calendar' : undefined;
    }
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
export function useMobileNavNavigate(): (id: MobileNavViewId) => void {
  const { openWithSplit } = useSplitLayout();
  const { toggleSettings } = useSettingsState();

  return (id) => {
    if (id === 'settings') {
      toggleSettings();
      return;
    }
    const fgContent = globalSplitManager()?.activeSplit()?.content();
    const isOnNavView =
      fgContent?.type === 'component' || fgContent?.type === 'calendar';
    openWithSplit(mobileNavContent(id), { mergeHistory: isOnNavView });
  };
}
