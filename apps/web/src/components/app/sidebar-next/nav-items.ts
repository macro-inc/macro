import { LIST_VIEW_PATHS } from '@app/constants/list-views';
import type { SidebarItem } from '@components/app/app-sidebar/sidebar';
import { TOKENS } from '@core/hotkey/tokens';
import BellIcon from '@phosphor/bell.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import ChatsCircleIcon from '@phosphor/chats-circle.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FolderSimpleIcon from '@phosphor/folder-simple.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import BellFillIcon from '@phosphor-fill/bell-fill.svg';
import BuildingsFillIcon from '@phosphor-fill/buildings-fill.svg';
import CalendarBlankFillIcon from '@phosphor-fill/calendar-blank-fill.svg';
import ChatsCircleFillIcon from '@phosphor-fill/chats-circle-fill.svg';
import EnvelopeFillIcon from '@phosphor-fill/envelope-fill.svg';
import FolderSimpleFillIcon from '@phosphor-fill/folder-simple-fill.svg';
import ListChecksFillIcon from '@phosphor-fill/list-checks-fill.svg';
import SparkleFillIcon from '@phosphor-fill/sparkle-fill.svg';
import type { NavIcon } from './nav-glyph';

/**
 * A SidebarRail nav button's definition: a `SidebarItem` plus the filled icon
 * the button cross-fades to while its view is active. Both are required here,
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
 * Phosphor icons rather than the animated `wide-*` set the old sidebar uses:
 * they are plain `fill="currentColor"` SVGs, so the active button's
 * `text-accent` colours the glyph.
 *
 * The labels are new but every destination is an existing view id, so the
 * `hotkeyToken`s are the ones `GoToHotkeys` already registers — `g i` still
 * reaches Activity, `g f` still reaches Drive. `GoToHotkeys` is mounted from
 * `Layout` off `buildSidebarLinks` and is independent of which sidebar renders,
 * so the shortcuts work unchanged; these tokens only label the tooltips.
 */
const SIDEBAR_NEXT_NAV_ITEMS = [
  {
    id: 'inbox',
    label: 'Activity',
    href: LIST_VIEW_PATHS.inbox,
    icon: BellIcon,
    iconActive: BellFillIcon,
    hotkey: 'i',
    hotkeyToken: TOKENS.sidebar.goTo.inbox,
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
    href: '/calendar',
    icon: CalendarBlankIcon,
    iconActive: CalendarBlankFillIcon,
    hotkey: 'r',
    hotkeyToken: TOKENS.sidebar.goTo.calendar,
  },
  {
    id: 'agents',
    label: 'Agents',
    href: LIST_VIEW_PATHS.agents,
    icon: SparkleIcon,
    iconActive: SparkleFillIcon,
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
] satisfies SidebarNextNavItem[];

/** The flag gates Calendar and Customers keep from `AppSidebar`. */
export type NavItemGates = {
  showCalendar: boolean;
  showCustomers: boolean;
};

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
    return true;
  });
