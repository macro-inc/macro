import { LIST_VIEW_PATHS } from '@app/constants/list-views';
import { calendarPath } from '@app/features/calendar-view/calendar-url';
import type { SidebarItem } from '@components/app/app-sidebar/sidebar';
import { TOKENS } from '@core/hotkey/tokens';
import BellIcon from '@phosphor/bell.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import ChatsCircleIcon from '@phosphor/chats-circle.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FolderSimpleIcon from '@phosphor/folder-simple.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import HouseIcon from '@phosphor/house.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import PhoneCallIcon from '@phosphor/phone-call.svg';
import AgentIcon from '@phosphor/sparkle.svg';
import BellFillIcon from '@phosphor-fill/bell-fill.svg';
import BuildingsFillIcon from '@phosphor-fill/buildings-fill.svg';
import CalendarBlankFillIcon from '@phosphor-fill/calendar-blank-fill.svg';
import ChatsCircleFillIcon from '@phosphor-fill/chats-circle-fill.svg';
import EnvelopeFillIcon from '@phosphor-fill/envelope-fill.svg';
import FolderSimpleFillIcon from '@phosphor-fill/folder-simple-fill.svg';
import GitPullRequestFillIcon from '@phosphor-fill/git-pull-request-fill.svg';
import HouseFillIcon from '@phosphor-fill/house-fill.svg';
import ListChecksFillIcon from '@phosphor-fill/list-checks-fill.svg';
import PhoneCallFillIcon from '@phosphor-fill/phone-call-fill.svg';
import AgentFillIcon from '@phosphor-fill/sparkle-fill.svg';
import type { NavIcon } from './nav-glyph';

/**
 * A SidebarRail nav button's definition: a `SidebarItem` plus the filled icon
 * the button switches to while its view is active. Both are required here,
 * unlike `SidebarItem['icon']` — a rail button is nothing but its glyph.
 */
export type SidebarNextNavItem = SidebarItem & {
  icon: NavIcon;
  /** Phosphor `fill` weight of `icon`, shown while the view is active. */
  iconActive: NavIcon;
};

/**
 * SidebarRail's nav buttons, in render order.
 *
 * Phosphor icons rather than the animated `wide-*` set: they are plain
 * `fill="currentColor"` SVGs, so the active button's `text-ink-muted` colours
 * the glyph.
 *
 * Every destination is an existing view id, so the `hotkeyToken`s are the ones
 * `GoToHotkeys` registers off `buildSidebarLinks` — `g h` reaches Home, `g f`
 * reaches Drive. These tokens only label the tooltips.
 */
const SIDEBAR_NEXT_NAV_ITEMS = [
  {
    id: 'home',
    label: 'Home',
    href: LIST_VIEW_PATHS.home,
    icon: HouseIcon,
    iconActive: HouseFillIcon,
    hotkey: 'h',
    hotkeyToken: TOKENS.sidebar.goTo.home,
  },
  {
    id: 'reminders',
    label: 'Reminders',
    href: LIST_VIEW_PATHS.reminders,
    icon: BellIcon,
    iconActive: BellFillIcon,
    hotkey: 'm',
    hotkeyToken: TOKENS.sidebar.goTo.reminders,
  },
  {
    id: 'documents',
    label: 'Drive',
    href: LIST_VIEW_PATHS.documents,
    icon: FolderSimpleIcon,
    iconActive: FolderSimpleFillIcon,
    hotkey: 'f',
    hotkeyToken: TOKENS.sidebar.goTo.documents,
  },
  {
    id: 'mail',
    label: 'Email',
    href: LIST_VIEW_PATHS.mail,
    icon: EnvelopeIcon,
    iconActive: EnvelopeFillIcon,
    hotkey: 'e',
    hotkeyToken: TOKENS.sidebar.goTo.mail,
  },
  {
    id: 'channels',
    label: 'Chat',
    href: LIST_VIEW_PATHS.channels,
    icon: ChatsCircleIcon,
    iconActive: ChatsCircleFillIcon,
    hotkey: 'c',
    hotkeyToken: TOKENS.sidebar.goTo.channels,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    href: LIST_VIEW_PATHS.tasks,
    icon: ListChecksIcon,
    iconActive: ListChecksFillIcon,
    hotkey: 't',
    hotkeyToken: TOKENS.sidebar.goTo.tasks,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    href: calendarPath('timeGridWeek'),
    icon: CalendarBlankIcon,
    iconActive: CalendarBlankFillIcon,
    hotkey: 'r',
    hotkeyToken: TOKENS.sidebar.goTo.calendar,
  },
  {
    id: 'agents',
    label: 'Agents',
    href: LIST_VIEW_PATHS.agents,
    icon: AgentIcon,
    iconActive: AgentFillIcon,
    hotkey: 'a',
    hotkeyToken: TOKENS.sidebar.goTo.agents,
  },
  {
    id: 'companies',
    label: 'Customers',
    href: LIST_VIEW_PATHS.companies,
    icon: BuildingsIcon,
    iconActive: BuildingsFillIcon,
    hotkey: 'o',
    hotkeyToken: TOKENS.sidebar.goTo.companies,
  },
  {
    id: 'calls',
    label: 'Calls',
    href: LIST_VIEW_PATHS.calls,
    icon: PhoneCallIcon,
    iconActive: PhoneCallFillIcon,
    hotkey: 'l',
    hotkeyToken: TOKENS.sidebar.goTo.calls,
  },
  {
    id: 'reviews',
    label: 'Reviews',
    href: '/reviews',
    icon: GitPullRequestIcon,
    iconActive: GitPullRequestFillIcon,
    hotkey: 'v',
    hotkeyToken: TOKENS.sidebar.goTo.reviews,
  },
] satisfies SidebarNextNavItem[];

/** Feature flag gates for feature-gated nav buttons. */
export type NavItemGates = {
  showCalendar: boolean;
  showCustomers: boolean;
  showReminders: boolean;
  showCalls: boolean;
  showReviews: boolean;
  /** User preferences for pinned/unpinned sidebar items. */
  pinnedItems?: Set<string>;
};

/**
 * The items available for the More menu (Calls, Reviews). These are shown
 * in the More menu by default, but can be pinned to the main sidebar.
 */
export const MORE_MENU_ITEM_IDS = ['calls', 'reviews'] as const;
export type MoreMenuItemId = (typeof MORE_MENU_ITEM_IDS)[number];

/**
 * Returns the nav items that should appear in the More menu (not pinned).
 */
export const moreMenuItems = (gates: NavItemGates): SidebarNextNavItem[] =>
  SIDEBAR_NEXT_NAV_ITEMS.filter((item) => {
    if (!MORE_MENU_ITEM_IDS.includes(item.id as MoreMenuItemId)) return false;
    if (item.id === 'calls' && !gates.showCalls) return false;
    if (item.id === 'reviews' && !gates.showReviews) return false;
    if (gates.pinnedItems?.has(item.id)) return false;
    return true;
  });

/**
 * The nav buttons on offer right now.
 *
 * Gates are passed in rather than read here: both are PostHog-backed, and the
 * imperative `ENABLE_CRM()` / `ENABLE_CALENDAR_UI()` readers call
 * `isFeatureEnabled` without tracking it, so a flag that resolves after mount
 * would never reach the rendered list. Callers subscribe with `useFeatureFlag`.
 */
export const visibleNavItems = (gates: NavItemGates): SidebarNextNavItem[] =>
  SIDEBAR_NEXT_NAV_ITEMS.filter((item) => {
    if (item.id === 'calendar') return gates.showCalendar;
    if (item.id === 'companies') return gates.showCustomers;
    if (item.id === 'reminders') return gates.showReminders;
    if (item.id === 'calls')
      return gates.showCalls && gates.pinnedItems?.has('calls');
    if (item.id === 'reviews')
      return gates.showReviews && gates.pinnedItems?.has('reviews');
    return true;
  });
