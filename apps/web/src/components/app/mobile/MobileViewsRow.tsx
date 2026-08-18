import { useCalendarUiFlag } from '@app/features/calendar/use-calendar-ui-flag';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import IconGear from '@icon/macro-gear.svg';
import WideCalendarIcon from '@icon/wide-calendar.svg';
import BellIcon from '@phosphor/bell-simple.svg';
import { createMemo } from 'solid-js';
import { FloatRegion } from './float-regions/FloatRegion';
import { MobileBottomEdgeFade } from './MobileEdgeFade';
import {
  useForegroundMobileView,
  useMobileNavNavigate,
} from './mobile-nav-state';
import type { MobileNavViewId } from './mobile-nav-views';
import { type PillTabItem, PillTabs } from './PillTabs';

/**
 * The global views pill row in the bottom (dock) slot, beneath the search
 * row. Doubles as the search scope switcher: it stays visible while the
 * search session is active (even with the keyboard up).
 */
export function MobileViewsRow() {
  const calendarUiEnabled = useCalendarUiFlag();
  // Highlight only the view that is actually the foreground split content —
  // with an entity (or anything else) open, no pill is active.
  const activeView = useForegroundMobileView();
  const navigate = useMobileNavNavigate();

  const items = createMemo<PillTabItem<MobileNavViewId>[]>(() => [
    {
      value: 'inbox',
      label: <BellIcon class="size-5" />,
      iconOnly: true,
      ariaLabel: 'Inbox',
    },
    ...(calendarUiEnabled()
      ? [
          {
            value: 'calendar' as const,
            label: <WideCalendarIcon class="size-5" />,
            iconOnly: true,
            ariaLabel: 'Calendar',
          },
        ]
      : []),
    { value: 'mail', label: 'Email' },
    { value: 'channels', label: 'Messages' },
    { value: 'documents', label: 'Files' },
    { value: 'agents', label: 'Agents' },
    { value: 'tasks', label: 'Tasks' },
    { value: 'calls', label: 'Calls' },
    {
      value: 'settings',
      label: <IconGear class="size-5" />,
      iconOnly: true,
      ariaLabel: 'Settings',
    },
  ]);

  return (
    <FloatRegion
      region="dock"
      active={() => !virtualKeyboardVisible() || SearchState.isOpen()}
    >
      <MobileBottomEdgeFade />
      {/* Full-bleed strip: the pills scroll to the device edge, and the
          chrome gutter travels with the scrolled content instead of insetting
          the scroll box. */}
      <PillTabs
        scrollable
        contentClass="px-(--mobile-chrome-gutter)"
        items={items()}
        value={activeView()}
        onChange={navigate}
      />
    </FloatRegion>
  );
}
