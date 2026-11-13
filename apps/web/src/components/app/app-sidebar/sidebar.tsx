import { GO_TO_COMMAND_SCOPE } from '@app/constants/hotkeys';
import {
  EXTERNAL_VIEW_PATH,
  LIST_VIEW_PATHS,
  type ListView,
} from '@app/constants/list-views';
import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { calendarPath } from '@app/features/calendar-view/calendar-url';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { requestSearchFocus } from '@app/features/next-soup/soup-view/search-controllers';
import { useRecentViewFlag } from '@app/features/next-soup/use-recent-view-flag';
import { useUnifiedNotificationsFlag } from '@app/features/notifications-inbox/use-unified-notifications-flag';
import {
  InviteModal,
  setInviteModalOpen,
} from '@app/features/team-invitations/invite-modal';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGoToLeader } from '@components/app/app-sidebar/go-to-leader';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type {
  ReferredFrom,
  SplitContent,
  SplitHandle,
} from '@components/app/split-layout/layoutManager';
import {
  canOpenInNewTab,
  openInNewTab,
} from '@components/app/tab-layout/open-in-new-tab';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { getIconConfig } from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_CALLS,
  enableCrm,
  enableTasksReviews,
  enableWhatsappLinked,
} from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import BellIcon from '@icon/system/regular/bell.svg';
import HomeIcon from '@icon/system/regular/house.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PlugIcon from '@icon/system/regular/plug.svg';
import ActivityIcon from '@icon/system/regular/pulse.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { cn } from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';

// TODO(sidebar-next): move to app-sidebar/navigation.tsx once SidebarRail ships.
export interface SidebarItem {
  id: ListView | (string & {});
  label: string;
  href: string;
  params?: Record<string, unknown>;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  hotkey?: ValidHotkey | ValidHotkey[];
  hotkeyToken: HotkeyToken;
  standaloneHotkey?: boolean;
  /** Extra Command-K search terms for the destination's GoTo command. */
  keywords?: string[];
}

/**
 * Home answers `g i` too, unless the Notifications link is on the rail: two
 * links on one key run only the first, so `i` belongs to Notifications then.
 */
const homeLink = (hotkey: ValidHotkey | ValidHotkey[]): SidebarItem => ({
  id: 'home',
  get label() {
    return isTouchDevice() ? t('nav.notifications') : t('nav.home');
  },
  href: LIST_VIEW_PATHS.home,
  get icon() {
    return isTouchDevice() ? BellIcon : HomeIcon;
  },
  hotkey,
  hotkeyToken: TOKENS.sidebar.goTo.home,
});

const SIDEBAR_LINKS = [
  homeLink(['h', 'i']),
  {
    id: 'search',
    get label() {
      return t('nav.search');
    },
    href: LIST_VIEW_PATHS.search,
    icon: SearchIcon,
    hotkey: '/',
    hotkeyToken: TOKENS.sidebar.goTo.search,
    standaloneHotkey: true,
  },
  {
    id: 'agents',
    get label() {
      return t('nav.agents');
    },
    href: LIST_VIEW_PATHS.agents,
    icon: getIconConfig('agent').icon,
    hotkey: 'a',
    hotkeyToken: TOKENS.sidebar.goTo.agents,
  },
  {
    id: 'mail',
    get label() {
      return t('nav.email');
    },
    href: LIST_VIEW_PATHS.mail,
    icon: getIconConfig('email').icon,
    hotkey: 'e',
    hotkeyToken: TOKENS.sidebar.goTo.mail,
  },
  {
    id: 'documents',
    get label() {
      return t('nav.files');
    },
    href: LIST_VIEW_PATHS.documents,
    icon: getIconConfig('files').icon,
    hotkey: 'f',
    hotkeyToken: TOKENS.sidebar.goTo.documents,
  },
  {
    id: 'documents',
    get label() {
      return t('nav.documents');
    },
    href: LIST_VIEW_PATHS.documents,
    params: {
      initialFacets: { type: ['doc-markdown'] },
    },
    icon: getIconConfig('md').icon,
    hotkey: 'd',
    hotkeyToken: TOKENS.sidebar.goTo.markdownDocuments,
  },
  {
    id: 'tasks',
    get label() {
      return t('nav.tasks');
    },
    href: LIST_VIEW_PATHS.tasks,
    icon: getIconConfig('task').icon,
    hotkey: 't',
    hotkeyToken: TOKENS.sidebar.goTo.tasks,
  },
  {
    id: 'calendar',
    get label() {
      return t('nav.calendar');
    },
    href: calendarPath('timeGridWeek'),
    icon: getIconConfig('calendar').icon,
    hotkey: 'r',
    hotkeyToken: TOKENS.sidebar.goTo.calendar,
  },
  {
    id: 'channels',
    get label() {
      return t('nav.chat');
    },
    href: LIST_VIEW_PATHS.channels,
    icon: getIconConfig('channel').icon,
    hotkey: 'c',
    hotkeyToken: TOKENS.sidebar.goTo.channels,
    keywords: ['Channels'],
  },
] satisfies SidebarItem[];

// Global view switches restore session context; explicit split opens stay fresh.
type OpenWithSplitFn = ReturnType<typeof useSplitLayout>['openWithSplit'];

export function sidebarContent(
  viewId: SidebarItem['id'],
  params?: SidebarItem['params']
): SplitContent {
  return {
    type: 'component',
    id: viewId === 'calendar' ? CALENDAR_VIEW_ID : viewId,
    params,
  };
}

/**
 * Navigate through the layout, resuming only views that opted into retention.
 * Holding shift opens a fresh view in a new split.
 */
export function navigateToSidebarView(args: {
  viewId: SidebarItem['id'];
  params?: SidebarItem['params'];
  shiftKey: boolean;
  openWithSplit: OpenWithSplitFn;
  referredFrom?: ReferredFrom;
  onApplied?: () => void;
}): SplitHandle | undefined {
  const { viewId, params, shiftKey, openWithSplit, referredFrom, onApplied } =
    args;

  return openWithSplit(sidebarContent(viewId, params), {
    preferNewSplit: shiftKey,
    resume: !shiftKey,
    mergeHistory: false,
    allowDuplicate: viewId !== 'calendar',
    referredFrom,
    onApplied,
  }).split;
}

/**
 * Hosts the always-on global shortcuts that must keep working even on
 * full-cover routes like solo settings: the "g" leader key with its per-link
 * "go to" nav hotkeys (e.g. "g h" for Home), plus Send Invites and the modal
 * it opens. Rendered unconditionally from `Layout` — unlike the sidebar, which
 * unmounts on those routes — so none of them go dead there.
 */
export const GoToHotkeys = () => {
  const { openWithSplit } = useSplitLayout();

  const inviteHotkey = registerHotkey({
    scopeId: 'global',
    hotkeyToken: TOKENS.global.inviteTeam,
    description: () => t('nav.sendInvites'),
    keyDownHandler: (e) => {
      e?.preventDefault();
      setInviteModalOpen(true);
      return true;
    },
  });

  const calendarUiEnabled = useCalendarUiFlag();
  const activityFeedEnabled = useActivityFeedFlag();
  const recentViewEnabled = useRecentViewFlag();
  const reviews = useFeatureFlag(enableTasksReviews);
  const notificationsEnabled = useUnifiedNotificationsFlag();
  const external = useFeatureFlag(enableWhatsappLinked);
  const crm = useFeatureFlag(enableCrm);
  const links = createMemo((): SidebarItem[] =>
    buildSidebarLinks(
      calendarUiEnabled(),
      activityFeedEnabled(),
      recentViewEnabled(),
      reviews().enabled,
      notificationsEnabled(),
      external().enabled,
      crm().enabled
    )
  );

  const goToLeader = useGoToLeader();

  // Send Invites registers in the 'global' scope, which outlives this
  // component, so dispose it on unmount. The per-link nav hotkeys below are
  // disposed by their own effect cleanup.
  onCleanup(() => inviteHotkey.dispose());

  // Register navigation shortcuts in the global GO_TO command scope.
  // This must be reactive because prod feature flags can add links after the
  // initial render (e.g. Home), and Hotkey UI resolves tokens from the registry.
  createEffect(() => {
    const disposers = links().map((link) => {
      const openSidebarView = (e?: KeyboardEvent) => {
        e?.preventDefault();
        goToLeader.leave();

        if (link.id === 'search' && !e?.shiftKey) {
          const activeSplit = globalSplitManager()?.activeSplit();
          const content = activeSplit?.content();
          if (
            activeSplit &&
            content?.type === 'component' &&
            content.id === 'search'
          ) {
            requestSearchFocus(activeSplit.id);
            return true;
          }
        }

        const handle = navigateToSidebarView({
          viewId: link.id,
          params: link.params,
          shiftKey: !!e?.shiftKey,
          openWithSplit,
          onApplied:
            link.id === 'search'
              ? () => {
                  const split = globalSplitManager()?.activeSplit();
                  if (split?.content().id === 'search')
                    requestSearchFocus(split.id);
                }
              : undefined,
        });
        if (link.id === 'search' && handle) {
          requestSearchFocus(handle.id);
        }
        return true;
      };

      return registerHotkey({
        hotkey: link.hotkey,
        scopeId: link.standaloneHotkey ? 'global' : GO_TO_COMMAND_SCOPE,
        hotkeyToken: link.hotkeyToken,
        description: () => t('nav.goTo', { label: link.label }),
        keywords: link.keywords,
        keyDownHandler: openSidebarView,
        icon: link.icon,
        // Views can claim a letter while focused (Email's g then i). Re-running
        // this effect when flags load must not eclipse those.
        registrationType: 'add',
      });
    });

    onCleanup(() => {
      for (const disposer of disposers) {
        disposer.dispose();
      }
    });
  });

  return <InviteModal />;
};

const CALLS_LINK: SidebarItem = {
  id: 'calls',
  get label() {
    return t('nav.calls');
  },
  href: LIST_VIEW_PATHS.calls,
  icon: getIconConfig('call').icon,
  hotkey: 'l',
  hotkeyToken: TOKENS.sidebar.goTo.calls,
};

const COMPANIES_LINK: SidebarItem = {
  id: 'companies',
  get label() {
    return t('nav.customers');
  },
  href: LIST_VIEW_PATHS.companies,
  icon: getIconConfig('company').icon,
  hotkey: 'o',
  hotkeyToken: TOKENS.sidebar.goTo.companies,
};

const NOTIFICATIONS_LINK: SidebarItem = {
  id: 'notifications',
  get label() {
    return t('nav.notifications');
  },
  href: '/notifications',
  icon: BellIcon,
  hotkey: 'i',
  hotkeyToken: TOKENS.sidebar.goTo.notifications,
};

const ACTIVITY_LINK: SidebarItem = {
  id: 'activity',
  get label() {
    return t('nav.activity');
  },
  href: '/activity',
  icon: ActivityIcon,
  hotkey: 'y',
  hotkeyToken: TOKENS.sidebar.goTo.activity,
};

const RECENT_LINK: SidebarItem = {
  id: 'recent',
  get label() {
    return t('nav.recent');
  },
  href: LIST_VIEW_PATHS.recent,
  icon: ActivityIcon,
  // `r` is Calendar and `e`/`c`/`t` are taken; `n` is the only letter of
  // "recent" that is not already a sidebar destination.
  hotkey: 'n',
  hotkeyToken: TOKENS.sidebar.goTo.recent,
};

const REVIEWS_LINK: SidebarItem = {
  id: 'reviews',
  get label() {
    return t('nav.reviews');
  },
  href: '/reviews',
  icon: getIconConfig('githubPullRequest').icon,
  hotkey: 'v',
  hotkeyToken: TOKENS.sidebar.goTo.reviews,
};

const EXTERNAL_LINK: SidebarItem = {
  id: 'external',
  get label() {
    return t('nav.external');
  },
  href: EXTERNAL_VIEW_PATH,
  icon: PlugIcon,
  // `e` is Email; `x` is the only free letter of "external".
  hotkey: 'x',
  hotkeyToken: TOKENS.sidebar.goTo.external,
};

/**
 * Assemble the ordered sidebar link list: the static links plus the
 * flag-gated Notifications, Recent, Activity, Calendar, Calls, Reviews, CRM,
 * and External entries in their correct positions. Callers subscribe to the
 * flags and pass them in, so a flag that resolves after mount still rebuilds
 * the list.
 */
export const buildSidebarLinks = (
  showCalendar: boolean,
  showActivity: boolean,
  showRecent: boolean,
  showReviews: boolean,
  showNotifications: boolean,
  showExternal: boolean,
  showCustomers: boolean
): SidebarItem[] => {
  let links: SidebarItem[] = SIDEBAR_LINKS.filter(
    (link) => showCalendar || link.id !== 'calendar'
  );

  const insertAfter = (anchorId: string, link: SidebarItem) => {
    const idx = links.findIndex((l) => l.id === anchorId);
    links = [...links.slice(0, idx + 1), link, ...links.slice(idx + 1)];
  };

  // Home leads; Notifications, Recent and Activity follow it in that order.
  let anchorId = 'home';
  if (showNotifications) {
    links = links.map((link) => (link.id === 'home' ? homeLink('h') : link));
    insertAfter(anchorId, NOTIFICATIONS_LINK);
    anchorId = 'notifications';
  }
  if (showRecent) {
    insertAfter(anchorId, RECENT_LINK);
    anchorId = 'recent';
  }
  if (showActivity) insertAfter(anchorId, ACTIVITY_LINK);

  if (ENABLE_CALLS) {
    const idx = links.findIndex((l) => l.id === 'channels');
    links = [...links.slice(0, idx + 1), CALLS_LINK, ...links.slice(idx + 1)];
  }

  if (showCustomers) {
    // Customers sits just after Channels (and Calls when present).
    const anchorId = ENABLE_CALLS ? 'calls' : 'channels';
    const idx = links.findIndex((l) => l.id === anchorId);
    links = [
      ...links.slice(0, idx + 1),
      COMPANIES_LINK,
      ...links.slice(idx + 1),
    ];
  }

  if (showReviews) {
    // Reviews sits at the end (accessed via More menu but has a hotkey).
    links = [...links, REVIEWS_LINK];
  }

  if (showExternal) links = [...links, EXTERNAL_LINK];

  return links;
};

interface SidebarOpenInSplitMenuProps {
  /** The content the menu's actions open. */
  content?: () => SplitContent;
  /** View-owned navigation for rows that select a location inside this split. */
  onOpenCurrentSplit?: () => void;
  onOpenNewSplit?: () => void;
  onOpenFullscreen?: () => void;
  onOpenChange?: (open: boolean) => void;
  /**
   * Overrides the trigger's default `h-7`, which otherwise clips triggers of a
   * different shape (`SidebarRail`'s are 36px squares). Merged with `cn`, so a
   * size utility here wins.
   */
  triggerClass?: string;
  additionalActions?: JSX.Element;
  children: JSX.Element;
}

/**
 * The shared sidebar right-click menu: open the row's content in the current
 * split, in a new split, or fullscreen.
 */
export const SidebarOpenInSplitMenu = (props: SidebarOpenInSplitMenuProps) => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? true;
  const canOpenFullscreen = () => layout.getSplitCount() > 1;

  const openInCurrentSplit = () => {
    if (props.onOpenCurrentSplit) {
      props.onOpenCurrentSplit();
      return;
    }
    if (!props.content) return;

    const result = layout.openWithSplit(props.content(), {
      allowDuplicate: true,
      mergeHistory: false,
      referredFrom: 'sidebar',
    });
    if (result.status === 'reused' && result.owner !== result.sourceOwner) {
      toast.alert(t('nav.contentAlreadyOpen'));
    }
  };

  const openInNewSplit = () => {
    const manager = globalSplitManager();
    if (!manager || !manager.canAppendSplit()) return;

    analytics.track('split_created', { from: 'sidebar' });

    if (props.onOpenNewSplit) {
      props.onOpenNewSplit();
      return;
    }

    if (!props.content) return;

    const result = manager.openWithSplit(props.content(), {
      activate: true,
      allowDuplicate: true,
      preferNewSplit: true,
      replaceWhenFull: false,
      referredFrom: 'sidebar',
    });
    if (result.status === 'reused' && result.owner !== result.sourceOwner) {
      toast.alert(t('nav.contentAlreadyOpen'));
    }
  };

  const openFullscreen = () => {
    if (props.onOpenFullscreen) {
      props.onOpenFullscreen();
      globalSplitManager()?.returnFocus();
      return;
    }

    if (!props.content) return;

    layout.replaceAllSplits(props.content(), {
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
  };

  return (
    <ContextMenu onOpenChange={props.onOpenChange}>
      <ContextMenu.Trigger class={cn('w-full h-7', props.triggerClass)}>
        {props.children}
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenuContent class="text-xs text-ink-muted">
          <MenuItem
            text={t('nav.openInNewSplit')}
            onClick={openInNewSplit}
            disabled={!canOpenInNewSplit()}
          />
          <Show when={canOpenInNewTab()}>
            <MenuItem
              text={t('nav.openInNewTab')}
              onClick={() => openInNewTab(openInCurrentSplit)}
            />
          </Show>
          <Show when={canOpenFullscreen()}>
            <MenuItem text={t('nav.openFullscreen')} onClick={openFullscreen} />
          </Show>
          <MenuItem
            text={t('nav.openInCurrentSplit')}
            onClick={openInCurrentSplit}
          />
          {props.additionalActions}
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
};
