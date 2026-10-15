import { LIST_VIEW_PATHS } from '@app/constants/list-views';
import { calendarPath } from '@app/features/calendar-view/calendar-url';
import type { SidebarItem } from '@components/app/app-sidebar/sidebar';
import { TOKENS } from '@core/hotkey/tokens';
import BuildingsFillIcon from '@icon/system/fill/buildings-fill.svg';
import CalendarBlankFillIcon from '@icon/system/fill/calendar-blank-fill.svg';
import ChatsCircleFillIcon from '@icon/system/fill/chats-circle-fill.svg';
import EnvelopeFillIcon from '@icon/system/fill/envelope-fill.svg';
import FolderSimpleFillIcon from '@icon/system/fill/folder-simple-fill.svg';
import GitPullRequestFillIcon from '@icon/system/fill/git-pull-request-fill.svg';
import HouseFillIcon from '@icon/system/fill/house-fill.svg';
import ListChecksFillIcon from '@icon/system/fill/list-checks-fill.svg';
import PhoneCallFillIcon from '@icon/system/fill/phone-call-fill.svg';
import AgentFillIcon from '@icon/system/fill/sparkle-fill.svg';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FolderSimpleIcon from '@icon/system/regular/folder-simple.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import HouseIcon from '@icon/system/regular/house.svg';
import ListChecksIcon from '@icon/system/regular/list-checks.svg';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import type { NavIcon } from './nav-glyph';
import type { SidebarPrefs } from './use-sidebar-prefs';

/**
 * A SidebarRail nav button's definition: a `SidebarItem` plus the filled icon
 * the button switches to while its view is active. Both are required here,
 * unlike `SidebarItem['icon']` — a rail button is nothing but its glyph.
 */
export type SidebarNextNavItem = SidebarItem & {
  icon: NavIcon;
  /** Matching Macro active glyph, shown while the view is active. */
  iconActive: NavIcon;
};

/**
 * SidebarRail's nav buttons, in default render order.
 *
 * Original Macro glyphs share one optical grid across regular and active
 * states. Both use currentColor so the button owns their emphasis.
 *
 * Every destination is an existing view id, so the `hotkeyToken`s are the ones
 * `GoToHotkeys` registers off `buildSidebarLinks` — `g h` reaches Home, `g f`
 * reaches Drive. These tokens only label the tooltips.
 */
export const SIDEBAR_NEXT_NAV_ITEMS = [
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
  showCalls: boolean;
  showReviews: boolean;
  /** User preferences for which items are shown and in what order. */
  prefs: SidebarPrefs;
};

/** Whether a feature-gated item is available for this account. */
export const isNavItemAvailable = (
  item: SidebarNextNavItem,
  gates: NavItemGates
): boolean => {
  if (item.id === 'calendar') return gates.showCalendar;
  if (item.id === 'companies') return gates.showCustomers;
  if (item.id === 'calls') return gates.showCalls;
  if (item.id === 'reviews') return gates.showReviews;
  return true;
};

/**
 * Apply the user's custom order. Home stays first. Ids absent from `order`
 * keep their relative catalog position after ordered ones.
 */
export const orderNavItems = (
  items: SidebarNextNavItem[],
  order: readonly string[]
): SidebarNextNavItem[] => {
  if (order.length === 0) return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  const used = new Set<string>();
  const result: SidebarNextNavItem[] = [];

  const home = byId.get('home');
  if (home) {
    result.push(home);
    used.add('home');
  }

  for (const id of order) {
    if (id === 'home' || used.has(id)) continue;
    const item = byId.get(id);
    if (item) {
      result.push(item);
      used.add(id);
    }
  }

  for (const item of items) {
    if (!used.has(item.id)) result.push(item);
  }

  return result;
};

/**
 * Available items in customize-menu order — includes both shown and hidden.
 * Home is always first.
 */
export const customizableNavItems = (
  gates: NavItemGates
): SidebarNextNavItem[] =>
  orderNavItems(
    SIDEBAR_NEXT_NAV_ITEMS.filter((item) => isNavItemAvailable(item, gates)),
    gates.prefs.order
  );

/**
 * Items hidden from the rail but available for quick open in the More menu.
 */
export const moreMenuItems = (gates: NavItemGates): SidebarNextNavItem[] =>
  customizableNavItems(gates).filter(
    (item) => item.id !== 'home' && gates.prefs.hidden.has(item.id)
  );

/**
 * The nav buttons currently on the outer rail.
 *
 * Gates are passed in rather than read here: both are PostHog-backed, and the
 * imperative `ENABLE_CRM()` / `ENABLE_CALENDAR_UI()` readers call
 * `isFeatureEnabled` without tracking it, so a flag that resolves after mount
 * would never reach the rendered list. Callers subscribe with `useFeatureFlag`.
 */
export const visibleNavItems = (gates: NavItemGates): SidebarNextNavItem[] =>
  customizableNavItems(gates).filter(
    (item) => item.id === 'home' || !gates.prefs.hidden.has(item.id)
  );
