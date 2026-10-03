import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import { LIST_VIEW_PATHS, type ListView } from '@app/constants/list-views';
import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { calendarPath } from '@app/features/calendar-view/calendar-url';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { CommandState } from '@app/features/command';
import { useGettingStartedEnabled } from '@app/features/getting-started/account-gate';
import { requestSearchFocus } from '@app/features/next-soup/soup-view/search-controllers';
import { useRecentViewFlag } from '@app/features/next-soup/use-recent-view-flag';
import {
  InviteModal,
  setInviteModalOpen,
} from '@app/features/team-invitations/invite-modal';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type {
  ReferredFrom,
  SplitContent,
  SplitHandle,
} from '@components/app/split-layout/layoutManager';
import { useLogout } from '@core/auth/logout';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { getIconConfig } from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import {
  ENABLE_CALLS,
  enableCrm,
  enableReminders,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { SettingsTab } from '@core/constant/SettingsState';
import { useEmail, useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { clearPressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ContextMenu } from '@kobalte/core/context-menu';
import BellIcon from '@phosphor/bell.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import CompassIcon from '@phosphor/compass.svg';
import GearIcon from '@phosphor/gear.svg';
import HomeIcon from '@phosphor/house.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import ActivityIcon from '@phosphor/pulse.svg';
import SignOutIcon from '@phosphor/sign-out.svg';
import { isRealNamePart, useOwnUserName } from '@queries/auth/user-name-self';
import { debounce } from '@solid-primitives/scheduled';
import { cn, Dropdown, Hotkey } from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
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
}

const SIDEBAR_LINKS = [
  {
    id: 'home',
    get label() {
      return isTouchDevice() ? 'Notifications' : 'Home';
    },
    href: LIST_VIEW_PATHS.home,
    get icon() {
      return isTouchDevice() ? BellIcon : HomeIcon;
    },
    hotkey: ['h', 'i'],
    hotkeyToken: TOKENS.sidebar.goTo.home,
  },
  {
    id: 'search',
    label: 'Search',
    href: LIST_VIEW_PATHS.search,
    icon: SearchIcon,
    hotkey: '/',
    hotkeyToken: TOKENS.sidebar.goTo.search,
    standaloneHotkey: true,
  },
  {
    id: 'agents',
    label: 'Agents',
    href: LIST_VIEW_PATHS.agents,
    icon: getIconConfig('agent').icon,
    hotkey: 'a',
    hotkeyToken: TOKENS.sidebar.goTo.agents,
  },
  {
    id: 'mail',
    label: 'Email',
    href: LIST_VIEW_PATHS.mail,
    icon: getIconConfig('email').icon,
    hotkey: 'e',
    hotkeyToken: TOKENS.sidebar.goTo.mail,
  },
  {
    id: 'email-marketing',
    label: 'Email Marketing',
    href: '/email-marketing',
    icon: getIconConfig('email').icon,
    hotkey: 'k',
    hotkeyToken: TOKENS.sidebar.goTo.emailMarketing,
  },

  {
    id: 'documents',
    label: 'Files',
    href: LIST_VIEW_PATHS.documents,
    icon: getIconConfig('files').icon,
    hotkey: 'f',
    hotkeyToken: TOKENS.sidebar.goTo.documents,
  },
  {
    id: 'documents',
    label: 'Documents',
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
    label: 'Tasks',
    href: LIST_VIEW_PATHS.tasks,
    icon: getIconConfig('task').icon,
    hotkey: 't',
    hotkeyToken: TOKENS.sidebar.goTo.tasks,
  },
  {
    id: 'reminders',
    label: 'Reminders',
    href: LIST_VIEW_PATHS.reminders,
    icon: getIconConfig('reminder').icon,
    hotkey: 'm',
    hotkeyToken: TOKENS.sidebar.goTo.reminders,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    href: calendarPath('timeGridWeek'),
    icon: getIconConfig('calendar').icon,
    hotkey: 'r',
    hotkeyToken: TOKENS.sidebar.goTo.calendar,
  },
  {
    id: 'channels',
    label: 'Channels',
    href: LIST_VIEW_PATHS.channels,
    icon: getIconConfig('channel').icon,
    hotkey: 'c',
    hotkeyToken: TOKENS.sidebar.goTo.channels,
  },
] satisfies SidebarItem[];

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
 * Navigate to a sidebar view by pushing a fresh entry into the active split.
 * Holding shift opens it in a new split. Use in-app back/forward to return to
 * prior entries.
 */
export function navigateToSidebarView(args: {
  viewId: SidebarItem['id'];
  params?: SidebarItem['params'];
  shiftKey: boolean;
  openWithSplit: OpenWithSplitFn;
  referredFrom?: ReferredFrom;
}): SplitHandle | undefined {
  const { viewId, params, shiftKey, openWithSplit, referredFrom } = args;

  return openWithSplit(sidebarContent(viewId, params), {
    preferNewSplit: shiftKey,
    mergeHistory: false,
    allowDuplicate: viewId !== 'calendar',
    referredFrom,
  }).split;
}

/** Whether the "g" leader key is currently awaiting a destination key. */
const [goToHotkeyVisible, setGoToHotkeyVisible] = createSignal(false);

const resetGoToHotkeysState = () => {
  setGoToHotkeyVisible(false);
  // To prevent the next key from triggering the hotkey handler,
  // we reset the pressed keys state and exit the command scope
  clearPressedKeys();
  activateClosestDOMScope();
};

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
    description: 'Send Invites',
    keyDownHandler: (e) => {
      e?.preventDefault();
      setInviteModalOpen(true);
      return true;
    },
  });

  const gettingStartedEnabled = useGettingStartedEnabled();
  const calendarUiEnabled = useCalendarUiFlag();
  const activityFeedEnabled = useActivityFeedFlag();
  const recentViewEnabled = useRecentViewFlag();
  const reminders = useFeatureFlag(enableReminders);
  const links = createMemo((): SidebarItem[] =>
    buildSidebarLinks(
      gettingStartedEnabled(),
      calendarUiEnabled(),
      activityFeedEnabled(),
      recentViewEnabled(),
      reminders().enabled
    )
  );

  const debounceResetHotkeysState = debounce(resetGoToHotkeysState, 2000);
  const debounceSetHotkeyVisible = debounce(
    () => setGoToHotkeyVisible(true),
    200
  );

  // Register 'g' as a leader key that activates the global GO_TO command scope
  const leaderHotkey = registerHotkey({
    hotkey: GO_TO_LEADER_KEY,
    scopeId: 'global',
    hotkeyToken: TOKENS.sidebar.goToLeader,
    description: 'Go to page',
    keyDownHandler: () => {
      // We debounce the time till the hot keys are visible to allow other commands
      // like g+g to fire
      debounceSetHotkeyVisible();
      debounceResetHotkeysState();
      return true;
    },
    activateCommandScopeId: GO_TO_COMMAND_SCOPE,
    hide: true,
    registrationType: 'add',
  });

  // These two register in the 'global' scope, which outlives this component, so
  // dispose them on unmount. Otherwise a remount (e.g. crossing the mobile
  // breakpoint) leaks: the 'add' leader stacks duplicate handlers and the
  // token-only invite command accumulates in the registry. The per-link nav
  // hotkeys below are disposed by their own effect cleanup.
  onCleanup(() => {
    inviteHotkey.dispose();
    leaderHotkey.dispose();
  });

  const registeredGoToKeys = () =>
    new Set<ValidHotkey>(links().flatMap((link) => link.hotkey ?? []));

  // When the go to command scope is active, we want to prevent
  // other default hotkeys from running. So doing "g" + some key
  // not part of the sidebar hotkeys, won't fire the command
  // for the key
  useHotkeyInterceptor((context) => {
    // If a hotkey is going to be fired, but the hotkeys are not
    // visible, then it's not a sidebar nav hotkey and we can
    // ignore it and reset our visible state
    if (!goToHotkeyVisible()) {
      debounceSetHotkeyVisible.clear();
      return false;
    }

    if (context.eventType !== 'keydown') return false;

    if (
      context.activeScopeId !== GO_TO_COMMAND_SCOPE ||
      registeredGoToKeys().has(context.pressedKeysString)
    ) {
      return false;
    }

    resetGoToHotkeysState();
    debounceResetHotkeysState.clear();

    return true;
  });

  // Register navigation shortcuts in the global GO_TO command scope.
  // This must be reactive because prod feature flags can add links after the
  // initial render (e.g. Home), and Hotkey UI resolves tokens from the registry.
  createEffect(() => {
    const disposers = links().map((link) => {
      const openSidebarView = (e?: KeyboardEvent) => {
        e?.preventDefault();
        if (goToHotkeyVisible()) {
          resetGoToHotkeysState();
          debounceResetHotkeysState.clear();
        }

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
        description: `Go to ${link.label}`,
        keyDownHandler: openSidebarView,
        icon: link.icon,
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

type SidebarSettingsWidgetProps = {
  isSlim: () => boolean;
  onSelect: (tab: SettingsTab) => void;
  onMenuOpenChange?: (open: boolean) => void;
  /**
   * Icon-only: drops the trigger's leading padding and start alignment so the
   * avatar centres in its square, and grows the avatar to nearly fill it. For
   * `SidebarRail`, where the name and caret are hidden anyway.
   */
  compact?: boolean;
};

export const SidebarSettingsWidget = (props: SidebarSettingsWidgetProps) => {
  const userId = useUserId();
  const email = useEmail();
  const logout = useLogout();

  const userName = useOwnUserName();

  // Prefer the user's real name (first/last); fall back to their email.
  const displayName = createMemo(() => {
    const name = userName();
    const parts = [name?.first_name, name?.last_name]
      .map((part) => part?.trim())
      .filter((part): part is string => isRealNamePart(part));
    return parts.length > 0 ? parts.join(' ') : (email() ?? 'Macro User');
  });

  return (
    <Dropdown
      placement="top-start"
      gutter={6}
      onOpenChange={props.onMenuOpenChange}
    >
      <Dropdown.Trigger
        variant="ghost"
        class={cn(
          'flex items-center cursor-default text-ink-extra-muted not-disabled:hover:bg-ink/3 h-9',
          props.compact
            ? 'justify-center gap-0 p-0'
            : 'justify-start gap-3 px-1.5 py-1'
        )}
        label={displayName()}
        fullWidth
        tooltipDisabled={!props.isSlim()}
        tooltipPlacement="right"
        onMouseDown={(e: MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
        }}
      >
        <Show
          when={userId()}
          fallback={
            <div
              class={cn(
                'shrink-0 rounded-full bg-ink/10',
                props.compact ? 'size-8' : 'size-5'
              )}
            />
          }
        >
          {(id) => (
            <div class={cn('shrink-0', props.compact ? 'size-8' : 'size-5')}>
              <UserIcon
                id={id()}
                size="fill"
                suppressClick
                showTooltip={false}
              />
            </div>
          )}
        </Show>
        <span class="flex-1 min-w-0 text-left whitespace-nowrap text-sm truncate group-data-[slim=true]/sidebar:hidden">
          {displayName()}
        </span>
        <CaretUpIcon class="size-3 text-ink-extra-muted shrink-0 group-data-[slim=true]/sidebar:hidden" />
      </Dropdown.Trigger>
      {/*
        The menu is shrink-to-fit, so without a cap a long name or email
        stretches it instead of engaging the `truncate` below.
      */}
      <Dropdown.Content class="min-w-[min(16rem,calc(100vw-1rem))] max-w-[min(20rem,calc(100vw-1rem))]">
        <Dropdown.Group class="p-1.5 gap-0">
          <div class="flex items-center gap-3 px-1 py-1">
            <Show
              when={userId()}
              fallback={<div class="size-10 shrink-0 rounded-full bg-ink/10" />}
            >
              {(id) => (
                <div class="size-10 shrink-0">
                  <UserIcon
                    id={id()}
                    size="fill"
                    suppressClick
                    showTooltip={false}
                  />
                </div>
              )}
            </Show>
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-ink">
                {displayName()}
              </div>
              <div class="truncate text-sm text-ink-muted">{email()}</div>
            </div>
          </div>
          <div class="-mx-1.5 mt-2 mb-1.5 h-px bg-edge-divider" />
          <Dropdown.Item
            class="flex items-center gap-2 px-2.5 py-2 text-sm cursor-default outline-none text-ink-muted"
            onSelect={() => CommandState.open()}
          >
            <span class="size-5 flex items-center justify-center text-ink-extra-muted">
              ⌘
            </span>
            <span class="flex-1 text-ink">Command menu</span>
            <Hotkey
              token={TOKENS.global.commandMenu}
              theme="subtle"
              class="ml-6"
            />
          </Dropdown.Item>
          <Dropdown.Item
            class="flex items-center gap-2 px-2.5 py-2 text-sm cursor-default outline-none text-ink-muted"
            onSelect={() => props.onSelect('Account')}
          >
            <span class="size-5 flex items-center justify-center">
              <GearIcon class="size-4 shrink-0 text-ink-extra-muted" />
            </span>
            <span class="flex-1 text-ink">Settings</span>
            <Hotkey
              token={TOKENS.global.toggleSettings}
              theme="subtle"
              class="ml-6"
            />
          </Dropdown.Item>
          <Dropdown.Item
            class="flex items-center gap-2 px-2.5 py-2 text-sm cursor-default outline-none text-failure"
            onSelect={() => logout()}
          >
            <span class="size-5 flex items-center justify-center">
              <SignOutIcon class="size-4 shrink-0" />
            </span>
            <span>Log out</span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};

const CALLS_LINK: SidebarItem = {
  id: 'calls',
  label: 'Calls',
  href: LIST_VIEW_PATHS.calls,
  icon: getIconConfig('call').icon,
  hotkey: 'l',
  hotkeyToken: TOKENS.sidebar.goTo.calls,
};

const COMPANIES_LINK: SidebarItem = {
  id: 'companies',
  label: 'Customers',
  href: LIST_VIEW_PATHS.companies,
  icon: getIconConfig('company').icon,
  hotkey: 'o',
  hotkeyToken: TOKENS.sidebar.goTo.companies,
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
  icon: ActivityIcon,
  hotkey: 'y',
  hotkeyToken: TOKENS.sidebar.goTo.activity,
};

const RECENT_LINK: SidebarItem = {
  id: 'recent',
  label: 'Recent',
  href: LIST_VIEW_PATHS.recent,
  icon: ActivityIcon,
  // `r` is Calendar and `e`/`c`/`t` are taken; `n` is the only letter of
  // "recent" that is not already a sidebar destination.
  hotkey: 'n',
  hotkeyToken: TOKENS.sidebar.goTo.recent,
};

/**
 * Assemble the ordered sidebar link list: the static links plus Getting
 * started and the flag-gated Recent, Activity, Calendar, Reminders, Calls, and CRM
 * entries in their correct positions.
 * Call from a reactive context — it reads `ENABLE_CALLS` / `isFeatureEnabled(enableCrm)`.
 * `showGettingStarted` is the account-age gate (`useGettingStartedEnabled`),
 * passed in because this runs outside a component; when false the link is
 * fully absent — `g s` hotkey and command menu entry.
 */
const buildSidebarLinks = (
  showGettingStarted: boolean,
  showCalendar: boolean,
  showActivity: boolean,
  showRecent: boolean,
  showReminders: boolean
): SidebarItem[] => {
  let links: SidebarItem[] = SIDEBAR_LINKS.filter(
    (link) =>
      (showCalendar || link.id !== 'calendar') &&
      (showReminders || link.id !== 'reminders')
  );

  const insertAfter = (anchorId: string, link: SidebarItem) => {
    const idx = links.findIndex((l) => l.id === anchorId);
    links = [...links.slice(0, idx + 1), link, ...links.slice(idx + 1)];
  };

  // Home leads; Getting started, Recent, and Activity follow it in that order.
  let anchorId = 'home';
  if (showGettingStarted) {
    insertAfter(anchorId, GETTING_STARTED_LINK);
    anchorId = 'getting-started';
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

  if (isFeatureEnabled(enableCrm)) {
    // Customers sits just after Channels (and Calls when present).
    const anchorId = ENABLE_CALLS ? 'calls' : 'channels';
    const idx = links.findIndex((l) => l.id === anchorId);
    links = [
      ...links.slice(0, idx + 1),
      COMPANIES_LINK,
      ...links.slice(idx + 1),
    ];
  }

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
      toast.alert('Content already open');
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
      toast.alert('Content already open');
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
            text="Open in new split"
            onClick={openInNewSplit}
            disabled={!canOpenInNewSplit()}
          />
          <Show when={canOpenFullscreen()}>
            <MenuItem text="Open fullscreen" onClick={openFullscreen} />
          </Show>
          <MenuItem text="Open in current split" onClick={openInCurrentSplit} />
          {props.additionalActions}
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
};
