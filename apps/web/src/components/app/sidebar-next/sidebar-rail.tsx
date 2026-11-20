import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { useHasActiveChannelsCall } from '@app/features/channels-view/use-has-active-call';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
import { cn } from '@ui';
import { For, Match, type ParentProps, Show, Suspense, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { useNavigationUnread } from '../use-navigation-unread';
import { SidebarRailCreateButton } from './create-button';
import { FooterActions } from './footer-actions';
import { ListNav, type ListNavProps } from './list-nav';
import { MoreMenu } from './more-menu';
import { visibleNavItems } from './nav-items';
import { useNextMeetingBadge } from './queries/use-next-meeting-badge';
import { ReturnToCallButton } from './return-to-call-button';
import { SearchRailButton } from './search-bar-button';
import { useNavItemGates } from './use-nav-item-gates';
import {
  type RailSize,
  useRailPlacement,
  useSidebarPrefs,
} from './use-sidebar-prefs';

/**
 * Rail buttons size themselves from these, so one setting resizes every
 * button and glyph. `--rail-scale` shrinks the few glyphs drawn at fixed pixel
 * geometry (the settings avatar cutout, the update ring).
 */
const RAIL_METRICS = {
  large: {
    '--rail-button': '2.5rem',
    '--rail-glyph': '1.25rem',
    '--rail-scale': '1',
  },
  small: {
    '--rail-button': '2rem',
    '--rail-glyph': '1rem',
    '--rail-scale': '0.8',
  },
} as const satisfies Record<RailSize, Record<string, string>>;

/** Line and page wheels report in those units rather than pixels. */
function wheelUnitPixels(event: WheelEvent, row: HTMLElement): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return row.clientWidth;
  return 1;
}

/**
 * A row of apps along the top or bottom edge scrolls sideways, which a plain
 * mouse wheel can't do (and the app hides scrollbars): turn vertical wheel
 * movement into horizontal scrolling there.
 */
function scrollRowWithWheel(event: WheelEvent) {
  const row = event.currentTarget;
  if (!(row instanceof HTMLElement)) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  if (row.scrollWidth <= row.clientWidth) return;

  event.preventDefault();
  row.scrollLeft += event.deltaY * wheelUnitPixels(event, row);
}

function ChannelsListNav(props: Omit<ListNavProps, 'activeCall'>) {
  const hasActiveCall = useHasActiveChannelsCall();
  return <ListNav {...props} activeCall={hasActiveCall()} />;
}

function CalendarListNav(props: Omit<ListNavProps, 'badge'>) {
  const badge = useNextMeetingBadge();
  return <ListNav {...props} badge={badge()?.label} />;
}

/**
 * The app sidebar: a single narrow strip of icon buttons, labels in tooltips,
 * docked to the window edge and at the size the rail preferences choose. On
 * the top or bottom edge it runs as a row; menus and tooltips always open
 * towards the page.
 *
 * There is no hover-peek overlay.
 * `cmd+.` toggles navigation in the active workspace. The `g`-prefixed
 * nav shortcuts are registered by `GoToHotkeys`, which `Layout` mounts
 * separately. Each button's tooltip carries its shortcut, and after `g` is
 * pressed each button shows its destination key in a corner badge.
 */
export const SidebarRail = () => {
  const gates = useNavItemGates();
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const unread = useNavigationUnread();
  const [calendarPreferences] = useCalendarPreferences();
  const { prefs } = useSidebarPrefs();
  const { horizontal } = useRailPlacement();

  const _openHome = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    analytics.track('sidebar_click', { view: 'home' });
    navigateToSidebarView({
      viewId: 'home',
      shiftKey: event.shiftKey,
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
  };

  return (
    <div
      {...hotkeyScopeNeutralAttribute}
      data-ui="sidebar-rail"
      style={RAIL_METRICS[prefs().size]}
      class={cn(
        'relative flex shrink-0 items-center gap-1 overflow-hidden bg-page',
        horizontal() ? 'w-full flex-row' : 'h-full flex-col',
        // Large keeps the original 56px strip; small is 44px.
        horizontal() && prefs().size === 'large' && 'h-14 px-2 py-1',
        horizontal() && prefs().size === 'small' && 'h-11 px-1.5 py-0.5',
        !horizontal() && prefs().size === 'large' && 'w-14 px-2 pb-3 pt-2',
        !horizontal() && prefs().size === 'small' && 'w-11 px-1.5 pb-2 pt-1.5'
      )}
    >
      <SidebarRailCreateButton />
      <SearchRailButton />

      {/* The scroller clips at its padding edge, so the padding on the cross
          axis leaves room for unread badges that overhang a button. */}
      <nav
        onWheel={(event) => {
          if (horizontal()) scrollRowWithWheel(event);
        }}
        class={cn(
          horizontal()
            ? 'flex min-w-0 items-center self-stretch overflow-x-auto overflow-y-hidden py-1 pl-4'
            : 'min-h-0 overflow-y-auto pt-4'
        )}
      >
        <ul
          class={cn(
            'flex items-center gap-1',
            horizontal() ? 'flex-row' : 'flex-col'
          )}
        >
          <For each={visibleNavItems(gates())}>
            {(item) => (
              <li class="flex">
                <Switch
                  fallback={
                    <ListNav
                      item={item}
                      unread={unread.has(item.id)}
                      unreadCount={unread.count(item.id)}
                      homeMode={gates().homeMode}
                    />
                  }
                >
                  <Match when={item.id === 'channels'}>
                    <Suspense
                      fallback={
                        <ListNav
                          item={item}
                          unread={unread.has(item.id)}
                          unreadCount={unread.count(item.id)}
                        />
                      }
                    >
                      <ChannelsListNav
                        item={item}
                        unread={unread.has(item.id)}
                        unreadCount={unread.count(item.id)}
                      />
                    </Suspense>
                  </Match>
                  <Match
                    when={
                      item.id === 'calendar' &&
                      calendarPreferences.showNextMeetingBadge
                    }
                  >
                    <Suspense fallback={<ListNav item={item} />}>
                      <CalendarListNav item={item} />
                    </Suspense>
                  </Match>
                </Switch>
              </li>
            )}
          </For>
        </ul>
      </nav>

      <MoreMenu gates={gates()} />

      <div class="min-h-0 min-w-0 flex-1" />

      <ReturnToCallButton />
      <FooterActions />
    </div>
  );
};

/**
 * The app frame beside the rail: docks the rail to the edge its preferences
 * name and lets the page fill the rest. `data-rail-edge` lets the page's own
 * inset drop the gutter on the rail's side.
 */
export function RailFrame(props: ParentProps<{ showRail: boolean }>) {
  const { prefs } = useSidebarPrefs();
  return (
    <div
      data-rail-edge={props.showRail ? prefs().position : undefined}
      // The rail comes first; reversing the axis puts it on the far edge.
      class={cn(
        'flex min-h-0 min-w-0 flex-1',
        match(prefs().position)
          .with('left', () => 'flex-row')
          .with('right', () => 'flex-row-reverse')
          .with('top', () => 'flex-col')
          .with('bottom', () => 'flex-col-reverse')
          .exhaustive()
      )}
    >
      <Show when={props.showRail}>
        <SidebarRail />
      </Show>
      {props.children}
    </div>
  );
}
