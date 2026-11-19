import { ViewSidebar } from '@app/components/view-shell';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { useHasActiveChannelsCall } from '@app/features/channels-view/use-has-active-call';
import { unreadLabel } from '@app/features/notifications-inbox/core/inbox-unread';
import { t } from '@app/lib/i18n';
import { SidebarOpenInSplitMenu } from '@components/app/app-sidebar/sidebar';
import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
import { UnreadCount } from '@entity/components/UnreadCount';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import PhoneCallIcon from '@icon/system/fill/phone-call-fill.svg';
import { For, Match, Show, Suspense, Switch } from 'solid-js';
import { unreadDescription } from '../unread-description';
import { useNavigationUnread } from '../use-navigation-unread';
import { SidebarRailCreateButton } from './create-button';
import { FooterActions } from './footer-actions';
import { isNavItemActive, useListNavAction } from './list-nav';
import { MoreMenu } from './more-menu';
import { NavGlyph } from './nav-glyph';
import { type SidebarNextNavItem, visibleNavItems } from './nav-items';
import { useNextMeetingBadge } from './queries/use-next-meeting-badge';
import { ReturnToCallButton } from './return-to-call-button';
import { SearchRailButton } from './search-bar-button';
import { useNavItemGates } from './use-nav-item-gates';
import { useSidebarPrefs } from './use-sidebar-prefs';

type AppRowProps = {
  item: SidebarNextNavItem;
  unread?: boolean;
  unreadCount?: number;
  activeCall?: boolean;
  /** The next meeting's time, e.g. `Now` or `12m`. */
  badge?: string;
};

/** One app in the single sidebar: the rail button's behavior as a labelled row. */
function AppRow(props: AppRowProps) {
  const { hideSidebarItem } = useSidebarPrefs();
  const nav = useListNavAction(() => props.item);
  const unreadCount = () =>
    props.unread ? unreadLabel(props.unreadCount) : undefined;

  return (
    <SidebarOpenInSplitMenu
      content={nav.content}
      triggerClass="h-auto"
      additionalActions={
        <Show when={props.item.id !== 'home'}>
          <MenuSeparator />
          <MenuItem
            text={t('nav.hideFromSidebar')}
            onClick={() => hideSidebarItem(props.item.id)}
          />
        </Show>
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

function ChannelsAppRow(props: Omit<AppRowProps, 'activeCall'>) {
  const hasActiveCall = useHasActiveChannelsCall();
  return <AppRow {...props} activeCall={hasActiveCall()} />;
}

function CalendarAppRow(props: Omit<AppRowProps, 'badge'>) {
  const badge = useNextMeetingBadge();
  return <AppRow {...props} badge={badge()?.label} />;
}

/**
 * Where the active split's workspace renders its navigation (see
 * `NavigationHost`). It fills the room the app rows leave, and takes none
 * while the workspace has no navigation. The navigation fills it absolutely,
 * as a docked split panel does, so the workspace's own list scrolls inside.
 */
function NavigationSlot(props: { ref: (element: HTMLElement) => void }) {
  return (
    <div
      ref={props.ref}
      class="relative -mr-(--sidebar-gutter) ml-1 min-h-40 flex-1 overflow-hidden empty:hidden"
      data-single-sidebar-slot=""
    />
  );
}

/**
 * The desktop app sidebar behind `enable-single-sidebar`: one column with the
 * apps as labelled rows and, under the active split's app, that workspace's
 * own navigation, in place of the icon rail beside a sidebar in every split.
 */
export function SingleSidebar(props: {
  /** Receives the element the active workspace's navigation renders into. */
  setNavigationSlot: (element: HTMLElement) => void;
}) {
  const gates = useNavItemGates();
  const unread = useNavigationUnread();
  const [calendarPreferences] = useCalendarPreferences();
  const items = () => visibleNavItems(gates());
  const appIsActive = () => items().some(isNavItemActive);

  return (
    <aside
      {...hotkeyScopeNeutralAttribute}
      aria-label={t('nav.appNavigation')}
      data-ui="single-sidebar"
      class="relative flex h-full w-64 shrink-0 flex-col bg-page"
    >
      <div class="flex shrink-0 items-center gap-1 px-2 pt-2 pb-2">
        <SidebarRailCreateButton />
        <SearchRailButton />
      </div>

      <nav class="flex min-h-0 flex-1 flex-col gap-(--sidebar-row-gap) overflow-y-auto px-(--sidebar-gutter)">
        <For each={items()}>
          {(item) => {
            const rowProps = () => ({
              item,
              unread: unread.has(item.id),
              unreadCount: unread.count(item.id),
            });
            return (
              <>
                <Switch fallback={<AppRow {...rowProps()} />}>
                  <Match when={item.id === 'channels'}>
                    <Suspense fallback={<AppRow {...rowProps()} />}>
                      <ChannelsAppRow {...rowProps()} />
                    </Suspense>
                  </Match>
                  <Match
                    when={
                      item.id === 'calendar' &&
                      calendarPreferences.showNextMeetingBadge
                    }
                  >
                    <Suspense fallback={<AppRow item={item} />}>
                      <CalendarAppRow item={item} />
                    </Suspense>
                  </Match>
                </Switch>
                <Show when={isNavItemActive(item)}>
                  <NavigationSlot ref={props.setNavigationSlot} />
                </Show>
              </>
            );
          }}
        </For>
        {/* A workspace reached from More or a link still shows its navigation. */}
        <Show when={!appIsActive()}>
          <NavigationSlot ref={props.setNavigationSlot} />
        </Show>
      </nav>

      <div class="flex shrink-0 items-center gap-1 px-2 pt-2 pb-3">
        <MoreMenu gates={gates()} />
        <div class="min-w-0 flex-1" />
        <ReturnToCallButton />
        <FooterActions horizontal />
      </div>
    </aside>
  );
}
