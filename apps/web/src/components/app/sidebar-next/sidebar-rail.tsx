import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { useHasActiveChannelsCall } from '@app/features/channels-view/use-has-active-call';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
import { cn } from '@ui';
import {
  createEffect,
  For,
  type JSX,
  Match,
  onCleanup,
  Suspense,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  type DockSize,
  dockAlignment,
  dockPosition,
  dockSize,
  isDockHorizontal,
} from '../dock-prefs';
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

function ChannelsListNav(props: Omit<ListNavProps, 'activeCall'>) {
  const hasActiveCall = useHasActiveChannelsCall();
  return <ListNav {...props} activeCall={hasActiveCall()} />;
}

function CalendarListNav(props: Omit<ListNavProps, 'badge'>) {
  const badge = useNextMeetingBadge();
  return <ListNav {...props} badge={badge()?.label} />;
}

/**
 * Button, glyph and bar sizes for each dock size, read by every rail button
 * through CSS variables so the buttons need no size props of their own.
 */
const DOCK_SIZE_VARIABLES = {
  large: {
    '--rail-thickness': '3.5rem',
    '--rail-padding': '0.5rem',
    '--rail-button-size': '2.5rem',
    '--rail-icon-size': '1.25rem',
    '--rail-help-icon-size': '1.5rem',
  },
  small: {
    '--rail-thickness': '2.75rem',
    '--rail-padding': '0.375rem',
    '--rail-button-size': '2rem',
    '--rail-icon-size': '1rem',
    '--rail-help-icon-size': '1.25rem',
  },
} satisfies Record<DockSize, JSX.CSSProperties>;

const DOCK_INSET_SIDES = ['left', 'right', 'bottom'] as const;

/**
 * Fixed overlays that sit in a window corner (toasts, incoming calls) are
 * portalled outside the rail, so the rail publishes its thickness on the
 * edge it occupies as `--dock-inset-<side>` on the root for them to clear.
 */
function publishDockInsets() {
  const root = document.documentElement;

  createEffect(() => {
    const thickness = DOCK_SIZE_VARIABLES[dockSize()]['--rail-thickness'];
    for (const side of DOCK_INSET_SIDES) {
      root.style.setProperty(
        `--dock-inset-${side}`,
        dockPosition() === side ? thickness : '0px'
      );
    }
  });

  onCleanup(() => {
    for (const side of DOCK_INSET_SIDES) {
      root.style.removeProperty(`--dock-inset-${side}`);
    }
  });
}

/**
 * A top or bottom dock that overflows the window scrolls sideways. Scrollbars
 * are hidden app-wide and a mouse wheel scrolls vertically, so turn vertical
 * wheel movement into horizontal scrolling.
 */
function scrollHorizontallyOnWheel(event: WheelEvent) {
  const nav = event.currentTarget;
  if (!(nav instanceof HTMLElement)) return;
  if (!isDockHorizontal()) return;
  // Ctrl+wheel (and trackpad pinch, which arrives as one) zooms the page.
  if (event.ctrlKey) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  if (nav.scrollWidth <= nav.clientWidth) return;

  event.preventDefault();
  nav.scrollLeft += event.deltaY;
}

const isDockCentered = () => dockAlignment() === 'center';

/**
 * One run of rail buttons: Create and Search at the start, the apps and More,
 * and the footer actions at the end. With the apps centered, the start and end
 * groups pin to the bar's ends; otherwise the apps follow Search and the end
 * group is pushed to the far end.
 */
function RailGroup(props: {
  place: 'start' | 'apps' | 'end';
  children: JSX.Element;
}) {
  const horizontal = isDockHorizontal;
  const placement = () =>
    match(props.place)
      .with(
        'start',
        () =>
          isDockCentered() &&
          (horizontal() ? 'justify-self-start' : 'self-start')
      )
      .with('apps', () =>
        cn(
          horizontal() ? 'max-w-full min-w-0' : 'max-h-full min-h-0',
          // With the end group pushed away by an auto margin, this keeps
          // the 8px before it (two gaps) when the apps overflow.
          !isDockCentered() && (horizontal() ? 'mr-1' : 'mb-1')
        )
      )
      .with('end', () => {
        if (isDockCentered()) {
          return horizontal() ? 'justify-self-end' : 'self-end';
        }
        return horizontal() ? 'ml-auto' : 'mt-auto';
      })
      .exhaustive();

  return (
    <div
      class={cn(
        'flex items-center gap-1',
        horizontal() ? 'flex-row' : 'flex-col',
        props.place !== 'apps' && 'shrink-0',
        props.place === 'end' && (horizontal() ? 'h-full' : 'w-full'),
        placement()
      )}
    >
      {props.children}
    </div>
  );
}

/**
 * The app sidebar (the dock): a single always-narrow bar of icon buttons,
 * labels in tooltips. It sits against the left, right, top or bottom edge, in
 * a large or small size, as chosen in Settings → Dock; menus and tooltips open
 * away from that edge.
 *
 * Always narrow by design — there is no slim mode or hover-peek overlay.
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
  publishDockInsets();

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
      style={DOCK_SIZE_VARIABLES[dockSize()]}
      class={cn(
        'relative shrink-0 gap-1 overflow-hidden bg-page',
        isDockHorizontal()
          ? 'h-(--rail-thickness) w-full py-(--rail-padding) pl-(--rail-padding) pr-3'
          : 'h-full w-(--rail-thickness) px-(--rail-padding) pt-(--rail-padding) pb-3',
        // Centered: three tracks, the apps in the middle one, so they center
        // on the whole bar however wide Create/Search and the footer are.
        // The middle track shrinks to 0 so a long app list scrolls instead.
        isDockCentered() && 'grid place-items-center',
        isDockCentered() &&
          (isDockHorizontal()
            ? 'grid-cols-[1fr_minmax(0,max-content)_1fr]'
            : 'grid-rows-[1fr_minmax(0,max-content)_1fr]'),
        !isDockCentered() && 'flex items-center',
        !isDockCentered() && (isDockHorizontal() ? 'flex-row' : 'flex-col')
      )}
    >
      <RailGroup place="start">
        <SidebarRailCreateButton />
        <SearchRailButton />
      </RailGroup>

      <RailGroup place="apps">
        <nav
          onWheel={scrollHorizontallyOnWheel}
          class={cn(
            isDockHorizontal()
              ? 'min-w-0 overflow-x-auto'
              : 'min-h-0 overflow-y-auto',
            // Inside the scroller, so scrolled apps pass under the space
            // after Search rather than being cut off at its edge.
            !isDockCentered() && (isDockHorizontal() ? 'pl-4' : 'pt-4')
          )}
        >
          <ul
            class={cn(
              'flex items-center gap-1',
              isDockHorizontal() ? 'flex-row' : 'flex-col'
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
      </RailGroup>

      <RailGroup place="end">
        <ReturnToCallButton />
        <FooterActions />
      </RailGroup>
    </div>
  );
};
