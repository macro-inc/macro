import { LIST_VIEW_PATHS, type ListView } from '@app/constants/list-views';
import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useGettingStartedEnabled } from '@app/features/getting-started/account-gate';
import { buildDocumentTypeQuery } from '@app/features/next-soup/filters/configs/document-type-query';
import { useRecentViewFlag } from '@app/features/next-soup/use-recent-view-flag';
import { ENABLE_CALLS, ENABLE_CRM } from '@core/constant/featureFlags';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { AnimatedActivityIcon } from '@icon/wide-activity';
import WideCalendarIcon from '@icon/wide-calendar.svg';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedCompanyIcon } from '@icon/wide-company';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedHomeIcon } from '@icon/wide-home';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import CompassIcon from '@phosphor/compass.svg';
import { type Component, createMemo, type JSX } from 'solid-js';

/**
 * A sidebar destination: the shared model behind the expanded sidebar rows,
 * the skinny rail's icons, and the `g`-leader "go to" hotkeys.
 */
export interface SidebarItem {
  id: ListView | (string & {});
  label: string;
  href: string;
  params?: Record<string, unknown>;
  icon?: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> & { triggerAnimation?: boolean }
  >;
  hotkey: ValidHotkey;
  hotkeyToken: HotkeyToken;
  standaloneHotkey?: boolean;
  hiddenFromSidebar?: boolean;
}

const markdownDocumentsQuery = buildDocumentTypeQuery(['doc-markdown']);

const SIDEBAR_LINKS = [
  {
    id: 'inbox',
    label: 'Inbox',
    href: LIST_VIEW_PATHS.inbox,
    icon: AnimatedInboxIcon,
    hotkey: 'i',
    hotkeyToken: TOKENS.sidebar.goTo.inbox,
  },
  {
    id: 'search',
    label: 'Search',
    href: LIST_VIEW_PATHS.search,
    icon: AnimatedSearchIcon,
    hotkey: '/',
    hotkeyToken: TOKENS.sidebar.goTo.search,
    standaloneHotkey: true,
    hiddenFromSidebar: true,
  },
  {
    id: 'agents',
    label: 'Agents',
    href: LIST_VIEW_PATHS.agents,
    icon: AnimatedStarIcon,
    hotkey: 'a',
    hotkeyToken: TOKENS.sidebar.goTo.agents,
  },
  {
    id: 'mail',
    label: 'Email',
    href: LIST_VIEW_PATHS.mail,
    icon: AnimatedEmailIcon,
    hotkey: 'e',
    hotkeyToken: TOKENS.sidebar.goTo.mail,
  },
  {
    id: 'documents',
    label: 'Files',
    href: LIST_VIEW_PATHS.documents,
    icon: AnimatedFileMdIcon,
    hotkey: 'f',
    hotkeyToken: TOKENS.sidebar.goTo.documents,
  },
  {
    id: 'documents',
    label: 'Documents',
    href: LIST_VIEW_PATHS.documents,
    params: {
      initialFilters: markdownDocumentsQuery ?? {},
      initialClientFilters: {
        and: ['document-or-file'],
        or: ['doc-markdown'],
      },
    },
    icon: AnimatedFileMdIcon,
    hotkey: 'd',
    hotkeyToken: TOKENS.sidebar.goTo.markdownDocuments,
    hiddenFromSidebar: true,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    href: LIST_VIEW_PATHS.tasks,
    icon: AnimatedTaskIcon,
    hotkey: 't',
    hotkeyToken: TOKENS.sidebar.goTo.tasks,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    href: '/calendar',
    icon: WideCalendarIcon,
    hotkey: 'r',
    hotkeyToken: TOKENS.sidebar.goTo.calendar,
  },
  {
    id: 'channels',
    label: 'Channels',
    href: LIST_VIEW_PATHS.channels,
    icon: AnimatedChannelIcon,
    hotkey: 'c',
    hotkeyToken: TOKENS.sidebar.goTo.channels,
  },
] satisfies SidebarItem[];

const CALLS_LINK: SidebarItem = {
  id: 'calls',
  label: 'Calls',
  href: LIST_VIEW_PATHS.calls,
  icon: AnimatedCallIcon,
  hotkey: 'l',
  hotkeyToken: TOKENS.sidebar.goTo.calls,
};

const COMPANIES_LINK: SidebarItem = {
  id: 'companies',
  label: 'Customers',
  href: LIST_VIEW_PATHS.companies,
  icon: AnimatedCompanyIcon,
  hotkey: 'o',
  hotkeyToken: TOKENS.sidebar.goTo.companies,
};

const DASHBOARD_LINK: SidebarItem = {
  id: 'home',
  label: 'Home',
  href: '/home',
  icon: AnimatedHomeIcon,
  hotkey: 'h',
  hotkeyToken: TOKENS.sidebar.goTo.home,
};

const GETTING_STARTED_LINK: SidebarItem = {
  id: 'getting-started',
  label: 'Getting Started',
  href: '/getting-started',
  icon: CompassIcon,
  hotkey: 's',
  hotkeyToken: TOKENS.sidebar.goTo.gettingStarted,
};

const ACTIVITY_LINK: SidebarItem = {
  id: 'activity',
  label: 'Activity',
  href: '/activity',
  icon: AnimatedActivityIcon,
  hotkey: 'y',
  hotkeyToken: TOKENS.sidebar.goTo.activity,
};

const RECENT_LINK: SidebarItem = {
  id: 'recent',
  label: 'Recent',
  href: LIST_VIEW_PATHS.recent,
  icon: AnimatedActivityIcon,
  // `r` is Calendar and `e`/`c`/`t` are taken; `n` is the only letter of
  // "recent" that is not already a sidebar destination.
  hotkey: 'n',
  hotkeyToken: TOKENS.sidebar.goTo.recent,
};

/**
 * Assemble the ordered sidebar link list: the static links plus Home, Getting
 * started, and the flag-gated Activity, Calendar, Calls, and CRM entries in
 * their correct positions.
 * Call from a reactive context — it reads `ENABLE_CALLS()` / `ENABLE_CRM()`;
 * {@link useSidebarLinks} is the wrapper every consumer should use.
 * `showGettingStarted` is the account-age gate (`useGettingStartedEnabled`),
 * passed in because this runs outside a component; when false the link is
 * fully absent — row, `g s` hotkey, and command menu entry.
 * Rendered sections additionally drop `hiddenFromSidebar` entries, which have
 * hotkeys but no sidebar row.
 */
const buildSidebarLinks = (
  showGettingStarted: boolean,
  showCalendar: boolean,
  showActivity: boolean,
  showRecent: boolean
): SidebarItem[] => {
  let links: SidebarItem[] = [
    DASHBOARD_LINK,
    ...(showGettingStarted ? [GETTING_STARTED_LINK] : []),
    ...SIDEBAR_LINKS.filter((link) => showCalendar || link.id !== 'calendar'),
  ];

  if (showRecent) {
    // Directly below Inbox; Activity anchors after it.
    const idx = links.findIndex((link) => link.id === 'inbox');
    links = [...links.slice(0, idx + 1), RECENT_LINK, ...links.slice(idx + 1)];
  }

  if (showActivity) {
    const anchorId = showRecent ? 'recent' : 'inbox';
    const idx = links.findIndex((link) => link.id === anchorId);
    links = [
      ...links.slice(0, idx + 1),
      ACTIVITY_LINK,
      ...links.slice(idx + 1),
    ];
  }

  if (ENABLE_CALLS()) {
    const idx = links.findIndex((l) => l.id === 'channels');
    links = [...links.slice(0, idx + 1), CALLS_LINK, ...links.slice(idx + 1)];
  }

  if (ENABLE_CRM()) {
    // Customers sits just after Channels (and Calls when present).
    const anchorId = ENABLE_CALLS() ? 'calls' : 'channels';
    const idx = links.findIndex((l) => l.id === anchorId);
    links = [
      ...links.slice(0, idx + 1),
      COMPANIES_LINK,
      ...links.slice(idx + 1),
    ];
  }

  return links;
};

/**
 * The reactive link list: {@link buildSidebarLinks} with its feature-flag gates
 * read for you. Call from a component — the expanded sidebar's rows, the skinny
 * rail's icons, and the always-mounted `GoToHotkeys` registrar all share it, so
 * their link sets can't drift.
 */
export const useSidebarLinks = () => {
  const gettingStartedEnabled = useGettingStartedEnabled();
  const calendarUiEnabled = useCalendarUiFlag();
  const activityFeedEnabled = useActivityFeedFlag();
  const recentViewEnabled = useRecentViewFlag();

  return createMemo((): SidebarItem[] =>
    buildSidebarLinks(
      gettingStartedEnabled(),
      calendarUiEnabled(),
      activityFeedEnabled(),
      recentViewEnabled()
    )
  );
};
