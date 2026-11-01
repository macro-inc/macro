import { EXTERNAL_VIEW_PATH, LIST_VIEW_PATHS } from '@app/constants/list-views';
import { calendarPath } from '@app/features/calendar-view/calendar-url';
import { t } from '@app/lib/i18n';
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
import PlugFillIcon from '@icon/system/fill/plug-fill.svg';
import AgentFillIcon from '@icon/system/fill/sparkle-fill.svg';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import CalendarCheckIcon from '@icon/system/regular/calendar-check.svg';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FolderSimpleIcon from '@icon/system/regular/folder-simple.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import HouseIcon from '@icon/system/regular/house.svg';
import ListChecksIcon from '@icon/system/regular/list-checks.svg';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import PlugIcon from '@icon/system/regular/plug.svg';
import PulseIcon from '@icon/system/regular/pulse.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import PulseFillIcon from '@phosphor-fill/pulse-fill.svg';
import type { NavIcon } from './nav-glyph';
import type { SidebarPrefs } from './use-sidebar-prefs';

/**
 * A SidebarRail nav button's definition: a `SidebarItem` plus the filled icon
 * the button switches to while its view is active. Both are required here,
 * unlike `SidebarItem['icon']` — a rail button is nothing but its glyph.
 */
export type SidebarNextNavItem = Omit<SidebarItem, 'hotkeyToken'> & {
  /** Only destinations with a registered GoTo shortcut expose a key hint. */
  hotkeyToken?: SidebarItem['hotkeyToken'];
  icon: NavIcon;
  /** Matching active variant of `icon`, shown while the view is active. */
  iconActive: NavIcon;
};

/** More-menu destinations do not require an active icon or keyboard shortcut. */
export type SidebarNextMenuItem = Omit<
  SidebarNextNavItem,
  'iconActive' | 'hotkeyToken'
>;

/**
 * SidebarRail's nav buttons, in default render order.
 *
 * Original Macro icons inherit `currentColor`, so the active button's `text-ink-muted` colours
 * the glyph.
 *
 * Every destination is an existing view id, so the `hotkeyToken`s are the ones
 * `GoToHotkeys` registers off `buildSidebarLinks` — `g h` reaches Home, `g f`
 * reaches Drive. These tokens only label the tooltips.
 */
export const SIDEBAR_NEXT_NAV_ITEMS = [
  {
    id: 'home',
    get label() {
      return t('nav.home');
    },
    href: LIST_VIEW_PATHS.home,
    icon: HouseIcon,
    iconActive: HouseFillIcon,
    hotkey: 'h',
    hotkeyToken: TOKENS.sidebar.goTo.home,
  },
  {
    id: 'documents',
    get label() {
      return t('nav.drive');
    },
    href: LIST_VIEW_PATHS.documents,
    icon: FolderSimpleIcon,
    iconActive: FolderSimpleFillIcon,
    hotkey: 'f',
    hotkeyToken: TOKENS.sidebar.goTo.documents,
  },
  {
    id: 'mail',
    get label() {
      return t('nav.email');
    },
    href: LIST_VIEW_PATHS.mail,
    icon: EnvelopeIcon,
    iconActive: EnvelopeFillIcon,
    hotkey: 'e',
    hotkeyToken: TOKENS.sidebar.goTo.mail,
  },
  {
    id: 'channels',
    get label() {
      return t('nav.chat');
    },
    href: LIST_VIEW_PATHS.channels,
    icon: ChatsCircleIcon,
    iconActive: ChatsCircleFillIcon,
    hotkey: 'c',
    hotkeyToken: TOKENS.sidebar.goTo.channels,
  },
  {
    id: 'tasks',
    get label() {
      return t('nav.tasks');
    },
    href: LIST_VIEW_PATHS.tasks,
    icon: ListChecksIcon,
    iconActive: ListChecksFillIcon,
    hotkey: 't',
    hotkeyToken: TOKENS.sidebar.goTo.tasks,
  },
  {
    id: 'calendar',
    get label() {
      return t('nav.calendar');
    },
    href: calendarPath('timeGridWeek'),
    icon: CalendarBlankIcon,
    iconActive: CalendarBlankFillIcon,
    hotkey: 'r',
    hotkeyToken: TOKENS.sidebar.goTo.calendar,
  },
  {
    id: 'agents',
    get label() {
      return t('nav.agents');
    },
    href: LIST_VIEW_PATHS.agents,
    icon: AgentIcon,
    iconActive: AgentFillIcon,
    hotkey: 'a',
    hotkeyToken: TOKENS.sidebar.goTo.agents,
  },
  {
    id: 'companies',
    get label() {
      return t('nav.customers');
    },
    href: LIST_VIEW_PATHS.companies,
    icon: BuildingsIcon,
    iconActive: BuildingsFillIcon,
    hotkey: 'o',
    hotkeyToken: TOKENS.sidebar.goTo.companies,
  },
  {
    id: 'calls',
    get label() {
      return t('nav.calls');
    },
    href: LIST_VIEW_PATHS.calls,
    icon: PhoneCallIcon,
    iconActive: PhoneCallFillIcon,
    hotkey: 'l',
    hotkeyToken: TOKENS.sidebar.goTo.calls,
  },
  {
    id: 'reviews',
    get label() {
      return t('nav.reviews');
    },
    href: '/reviews',
    icon: GitPullRequestIcon,
    iconActive: GitPullRequestFillIcon,
    hotkey: 'v',
    hotkeyToken: TOKENS.sidebar.goTo.reviews,
  },
  {
    id: 'activity',
    label: 'Activity',
    href: '/activity',
    icon: PulseIcon,
    iconActive: PulseFillIcon,
    hotkey: 'y',
    hotkeyToken: TOKENS.sidebar.goTo.activity,
  },
  {
    id: 'booking-links',
    get label() {
      return t('nav.scheduling');
    },
    href: '/scheduling',
    icon: CalendarCheckIcon,
    iconActive: CalendarCheckIcon,
  },
  {
    id: 'external',
    get label() {
      return t('nav.external');
    },
    href: EXTERNAL_VIEW_PATH,
    icon: PlugIcon,
    iconActive: PlugFillIcon,
    hotkey: 'x',
    hotkeyToken: TOKENS.sidebar.goTo.external,
  },
] satisfies SidebarNextNavItem[];

/** Feature flag gates for sidebar destinations. */
export type NavItemGates = {
  showCalendar: boolean;
  showScheduling: boolean;
  showCustomers: boolean;
  showCalls: boolean;
  showReviews: boolean;
  showActivity: boolean;
  showExternal: boolean;
  /** User preferences for which items are shown and in what order. */
  prefs: SidebarPrefs;
};

/** Whether a feature-gated item is available for this account. */
export const isNavItemAvailable = (
  item: SidebarNextNavItem,
  gates: NavItemGates
): boolean => {
  if (item.id === 'calendar') return gates.showCalendar;
  if (item.id === 'booking-links') return gates.showScheduling;
  if (item.id === 'companies') return gates.showCustomers;
  if (item.id === 'calls') return gates.showCalls;
  if (item.id === 'reviews') return gates.showReviews;
  if (item.id === 'activity') return gates.showActivity;
  if (item.id === 'external') return gates.showExternal;
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

/** Hidden rail items, available for quick open in the More menu. */
export const moreMenuItems = (gates: NavItemGates): SidebarNextMenuItem[] =>
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
