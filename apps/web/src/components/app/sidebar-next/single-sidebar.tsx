import { ViewSidebar } from '@app/components/view-shell';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { useHasActiveChannelsCall } from '@app/features/channels-view/use-has-active-call';
import { unreadLabel } from '@app/features/notifications-inbox/core/inbox-unread';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  navigateToSidebarView,
  SidebarOpenInSplitMenu,
  sidebarContent,
} from '@components/app/app-sidebar/sidebar';
import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
import { lazyNamed } from '@core/util/lazyNamed';
import { UnreadCount } from '@entity/components/UnreadCount';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import PhoneCallIcon from '@icon/system/fill/phone-call-fill.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import SidebarIcon from '@icon/system/regular/sidebar-simple.svg';
import { Button, Dropdown } from '@ui';
import { For, Match, Show, Suspense, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useSplitLayout } from '../split-layout/layout';
import { unreadDescription } from '../unread-description';
import { useNavigationUnread } from '../use-navigation-unread';
import { NewSidebarRow } from './create-button';
import { FooterActions } from './footer-actions';
import { useListNavAction } from './list-nav';
import { NavGlyph } from './nav-glyph';
import {
  isNavItemAvailable,
  SIDEBAR_NEXT_NAV_ITEMS,
  type SidebarNextNavItem,
} from './nav-items';
import { useNextMeetingBadge } from './queries/use-next-meeting-badge';
import { ReturnToCallButton } from './return-to-call-button';
import { SearchSidebarRow } from './search-bar-button';
import { useSingleSidebarPins } from './single-sidebar-pins';
import { useNavItemGates } from './use-nav-item-gates';

// Both read entity lists; keep them out of the startup bundle.
const FavoritesSection = lazyNamed(
  () => import('./favorites-section'),
  'FavoritesSection'
);
const RecentsSection = lazyNamed(
  () => import('./recents-section'),
  'RecentsSection'
);

type PinnedRowProps = {
  item: SidebarNextNavItem;
  unread?: boolean;
  unreadCount?: number;
  activeCall?: boolean;
  /** The next meeting's time, e.g. `Now` or `12m`. */
  badge?: string;
  onUnpin: () => void;
};

/** A pinned app: the rail button's behavior as a labelled row. */
function PinnedRow(props: PinnedRowProps) {
  const nav = useListNavAction(() => props.item);
  const unreadCount = () =>
    props.unread ? unreadLabel(props.unreadCount) : undefined;

  return (
    <SidebarOpenInSplitMenu
      content={nav.content}
      triggerClass="h-auto"
      additionalActions={
        <>
          <MenuSeparator />
          <MenuItem
            text={t('nav.unpinFromSidebar')}
            onClick={() => props.onUnpin()}
          />
        </>
      }
    >
      <ViewSidebar.Item
        active={nav.isActive()}
        class="cursor-default"
        aria-description={
          [
            props.unread &&
              (unreadDescription(props.unreadCount) ?? t('nav.unreadItems')),
            props.activeCall && t('nav.activeCall'),
            props.badge && t('nav.nextMeeting', { time: props.badge }),
          ]
            .filter(Boolean)
            .join('. ') || undefined
        }
        draggable={false}
        data-active={nav.isActive() ? '' : undefined}
        data-sidebar-next-item={props.item.id}
        data-unread={props.unread ? '' : undefined}
        onMouseEnter={nav.preload}
        onFocus={nav.preload}
        onMouseDown={nav.onMouseDown}
        onClick={nav.onClick}
      >
        <ViewSidebar.Icon>
          <NavGlyph
            icon={props.item.icon}
            iconActive={props.item.iconActive}
            filled={nav.isActive()}
            class="size-4"
          />
        </ViewSidebar.Icon>
        <span class="min-w-0 flex-1 truncate">{props.item.label}</span>
        <Switch>
          <Match when={props.activeCall}>
            <PhoneCallIcon aria-hidden="true" class="size-3.5 text-accent" />
          </Match>
          <Match when={props.badge}>
            {(badge) => (
              <span
                aria-hidden="true"
                class="rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold tabular-nums text-surface"
              >
                {badge()}
              </span>
            )}
          </Match>
          <Match when={unreadCount()}>
            {(count) => <UnreadCount label={count()} class="ring-0" />}
          </Match>
          <Match when={props.unread}>
            <span aria-hidden="true" class="flex size-3.5 items-center">
              <UnreadIndicator active class="size-1.5" />
            </span>
          </Match>
        </Switch>
      </ViewSidebar.Item>
    </SidebarOpenInSplitMenu>
  );
}

function ChannelsPinnedRow(props: Omit<PinnedRowProps, 'activeCall'>) {
  const hasActiveCall = useHasActiveChannelsCall();
  return <PinnedRow {...props} activeCall={hasActiveCall()} />;
}

function CalendarPinnedRow(props: Omit<PinnedRowProps, 'badge'>) {
  const badge = useNextMeetingBadge();
  return <PinnedRow {...props} badge={badge()?.label} />;
}

/**
 * More…: opens any destination that isn't pinned, and pins or unpins any of
 * them. Shift opens the destination in a new split.
 */
function MoreRow(props: {
  destinations: SidebarNextNavItem[];
  isPinned: (id: string) => boolean;
  setPinned: (id: string, pinned: boolean) => void;
}) {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const unpinned = () =>
    props.destinations.filter((item) => !props.isPinned(item.id));

  // onSelect omits the event, so capture Shift from the press.
  let shiftHeld = false;
  const captureSplitIntent = (event: PointerEvent | KeyboardEvent) => {
    shiftHeld = event.shiftKey;
  };
  const open = (item: SidebarNextNavItem) => {
    analytics.track('sidebar_click', { view: item.id });
    navigateToSidebarView({
      viewId: item.id,
      params: item.params,
      shiftKey: shiftHeld,
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
  };

  return (
    <Dropdown placement="right-start" gutter={6}>
      <Dropdown.Trigger
        variant="ghost"
        size="md"
        fullWidth
        class="cursor-default justify-start px-(--sidebar-item-inset) font-normal text-ink-muted"
        draggable={false}
        data-sidebar-next-item="more"
      >
        <span class="flex size-(--sidebar-icon-slot) items-center justify-center">
          <DotsThreeIcon class="size-4" />
        </span>
        {t('nav.moreApps')}
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-[14rem]">
        <Show when={unpinned().length > 0}>
          <Dropdown.Group>
            <For each={unpinned()}>
              {(item) => (
                <Dropdown.Item
                  class="gap-2"
                  onMouseEnter={() =>
                    layout.preloadContent(sidebarContent(item.id, item.params))
                  }
                  onPointerDown={captureSplitIntent}
                  onKeyDown={captureSplitIntent}
                  onSelect={() => open(item)}
                >
                  <Dynamic
                    component={item.icon}
                    class="size-4 shrink-0 text-ink-muted"
                  />
                  <span class="flex-1 truncate text-ink">{item.label}</span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Show>
        <Dropdown.Group>
          <Dropdown.Sub>
            <Dropdown.SubTrigger>{t('nav.pinToSidebar')}</Dropdown.SubTrigger>
            <Dropdown.SubContent class="min-w-[12rem]">
              <For each={props.destinations}>
                {(item) => (
                  <Dropdown.CheckboxItem
                    checked={props.isPinned(item.id)}
                    onChange={(checked) => props.setPinned(item.id, checked)}
                    closeOnSelect={false}
                  >
                    {item.label}
                  </Dropdown.CheckboxItem>
                )}
              </For>
            </Dropdown.SubContent>
          </Dropdown.Sub>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/**
 * The desktop app sidebar behind `enable-single-sidebar`, in place of the icon
 * rail: New and Search, the pinned apps, More… (everything else, and pinning),
 * favorites, and recents. Each app keeps its own navigation in its split.
 */
export function SingleSidebar(props: { onCollapse: () => void }) {
  const gates = useNavItemGates();
  const unread = useNavigationUnread();
  const [calendarPreferences] = useCalendarPreferences();
  const pins = useSingleSidebarPins();
  const destinations = () =>
    SIDEBAR_NEXT_NAV_ITEMS.filter((item) => isNavItemAvailable(item, gates()));
  const pinned = () => {
    const byId = new Map<string, SidebarNextNavItem>(
      destinations().map((item) => [item.id, item])
    );
    return pins
      .pins()
      .map((id) => byId.get(id))
      .filter((item): item is SidebarNextNavItem => item !== undefined);
  };

  return (
    <aside
      {...hotkeyScopeNeutralAttribute}
      aria-label={t('nav.appNavigation')}
      data-ui="single-sidebar"
      class="relative flex h-full w-64 shrink-0 flex-col bg-page"
    >
      <div class="flex h-10 shrink-0 items-center px-(--sidebar-gutter) pt-1">
        <Button
          variant="ghost"
          size="icon-md"
          aria-label={t('nav.collapseSidebar')}
          tooltip={{ content: t('nav.collapseSidebar') }}
          onClick={() => props.onCollapse()}
        >
          <SidebarIcon class="size-4" />
        </Button>
      </div>

      <ViewSidebar.Nav class="px-(--sidebar-gutter) pt-1">
        <NewSidebarRow />
        <SearchSidebarRow />
      </ViewSidebar.Nav>

      <ViewSidebar.Nav
        aria-label={t('nav.appNavigation')}
        class="px-(--sidebar-gutter) pt-4"
      >
        <For each={pinned()}>
          {(item) => {
            const rowProps = () => ({
              item,
              unread: unread.has(item.id),
              unreadCount: unread.count(item.id),
              onUnpin: () => pins.setPinned(item.id, false),
            });
            return (
              <Switch fallback={<PinnedRow {...rowProps()} />}>
                <Match when={item.id === 'channels'}>
                  <Suspense fallback={<PinnedRow {...rowProps()} />}>
                    <ChannelsPinnedRow {...rowProps()} />
                  </Suspense>
                </Match>
                <Match
                  when={
                    item.id === 'calendar' &&
                    calendarPreferences.showNextMeetingBadge
                  }
                >
                  <Suspense fallback={<PinnedRow {...rowProps()} />}>
                    <CalendarPinnedRow {...rowProps()} />
                  </Suspense>
                </Match>
              </Switch>
            );
          }}
        </For>
        <MoreRow
          destinations={destinations()}
          isPinned={pins.isPinned}
          setPinned={pins.setPinned}
        />
      </ViewSidebar.Nav>

      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-(--sidebar-gutter) pb-2">
        <Suspense>
          <FavoritesSection />
        </Suspense>
        <Suspense>
          <RecentsSection />
        </Suspense>
      </div>

      <div class="flex shrink-0 flex-wrap items-center justify-end gap-1 border-t border-edge-muted px-2 pt-2 pb-3">
        <ReturnToCallButton />
        <FooterActions horizontal />
      </div>
    </aside>
  );
}
