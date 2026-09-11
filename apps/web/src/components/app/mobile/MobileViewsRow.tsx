import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { createMemo } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { FloatRegion } from './float-regions/FloatRegion';
import { useMobileDockViews } from './mobile-dock-views';
import type { MobileNavViewId } from './mobile-nav-views';
import { type PillTabItem, PillTabs } from './PillTabs';
import {
  useForegroundMobileView,
  useMobileNavNavigate,
} from './use-mobile-nav';

/**
 * The views pill row in the accessory slot, above the dock row. It shows
 * only while a search session is active (the dock is in its search layout),
 * acting as the search scope switcher — even with the keyboard up.
 */
export function MobileViewsRow() {
  // Highlight only the view that is actually the foreground split content —
  // with an entity (or anything else) open, no pill is active.
  const activeView = useForegroundMobileView();
  const navigate = useMobileNavNavigate();
  const dockViews = useMobileDockViews();

  const items = createMemo<PillTabItem<MobileNavViewId>[]>(() => [
    { value: 'search', label: 'All' },
    ...dockViews().map((view) =>
      view.pillIcon
        ? {
            value: view.id,
            label: <Dynamic component={view.pillIcon} class="size-5" />,
            iconOnly: true,
            ariaLabel: view.label,
          }
        : { value: view.id, label: view.label }
    ),
  ]);

  return (
    <FloatRegion
      region="accessory"
      // While a search session is open the scope pills outbid any other
      // accessory contributor (per-view compose/reply bars own the slot the
      // rest of the time).
      priority={100}
      active={() => SearchState.isOpen()}
    >
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
