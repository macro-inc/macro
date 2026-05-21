import { useAnalytics } from '@app/component/analytics-context';
import { ChannelsUnreadWidget } from '@app/component/app-sidebar/channels-unread-widget';
import {
  InviteModal,
  setInviteModalOpen,
} from '@app/component/app-sidebar/invite-modal';
import { CommandState } from '@app/component/command';
import { createMenuOpen, setCreateMenuOpen } from '@app/component/Launcher';
import { requestSearchFocus } from '@app/component/next-soup/soup-view/search-controllers';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import {
  LIST_VIEW_ID,
  LIST_VIEW_PATHS,
  type ListView,
} from '@app/constants/list-views';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { globalSplitManager } from '@app/signal/splitLayout';
import { InCallPanel } from '@channel/Call';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { ContextMenuContent, MenuItem } from '@core/component/Menu';
import { UserIcon } from '@core/component/UserIcon';
import {
  DEV_MODE_ENV,
  ENABLE_APP_STORE_QR_CODE,
  ENABLE_CALLS,
  ENABLE_TEAMS_OVERRIDE,
} from '@core/constant/featureFlags';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { clearPressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import LogoIcon from '@icon/macro-logo.svg';
import SquareSidebarIcon from '@icon/square-sidebar.svg';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import CommandKIcon from '@icon/wide-command-k.svg';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedFolderIcon } from '@icon/wide-folder';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedNewSplitIcon } from '@icon/wide-newSplit';
import { AnimatedPlusIcon } from '@icon/wide-plus';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import { ContextMenu } from '@kobalte/core/context-menu';
import { useNotificationSettings } from '@notifications';
import BellIcon from '@phosphor/bell.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import DeviceMobileIcon from '@phosphor/device-mobile-speaker.svg';
import KeyboardIcon from '@phosphor/keyboard.svg';
import PaintBucketIcon from '@phosphor/paint-bucket.svg';
import PlugIcon from '@phosphor/plug.svg';
import UserIconPhosphor from '@phosphor/user.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { debounce } from '@solid-primitives/scheduled';
import { useLocation } from '@solidjs/router';
import { Button, cn, Dropdown, Hotkey } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

interface SidebarItem {
  id: ListView;
  label: string;
  href: string;
  icon?: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
  >;
  hotkey: ValidHotkey;
  hotkeyToken: HotkeyToken;
  standaloneHotkey?: boolean;
}

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
    label: 'Documents',
    href: LIST_VIEW_PATHS.documents,
    icon: AnimatedFileMdIcon,
    hotkey: 'd',
    hotkeyToken: TOKENS.sidebar.goTo.documents,
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
    id: 'channels',
    label: 'Channels',
    href: LIST_VIEW_PATHS.channels,
    icon: AnimatedChannelIcon,
    hotkey: 'c',
    hotkeyToken: TOKENS.sidebar.goTo.channels,
  },
  {
    id: 'folders',
    label: 'Folders',
    href: LIST_VIEW_PATHS.folders,
    icon: AnimatedFolderIcon,
    hotkey: 'f',
    hotkeyToken: TOKENS.sidebar.goTo.folders,
  },
] satisfies SidebarItem[];

export type SidebarState = 'hidden' | 'expanded' | 'slim';

/** Root sidebar `max-width` transition (see `SIDEBAR_MAX_WIDTH_TRANSITION_STYLE`). */
const SIDEBAR_MAX_WIDTH_TRANSITION_MS = 100;
const SIDEBAR_MAX_WIDTH_TRANSITION_STYLE = `max-width ease-in-out ${SIDEBAR_MAX_WIDTH_TRANSITION_MS}ms`;

/**
 * InCallPanel stays in slim layout until the sidebar shell finishes widening.
 * Uses `transitionend` on that element’s `max-width` (no timer on the happy path);
 * a short fallback timeout covers reduced-motion / no-op layout.
 */
function createInCallPanelSlimToggle(args: {
  initialSlim: boolean;
  parentOnOpenChange: (open: boolean) => void;
  getShell: () => HTMLDivElement | undefined;
}) {
  const [panelIsSlim, setPanelIsSlim] = createSignal(args.initialSlim);
  let shellEl: HTMLDivElement | undefined;
  let onMaxWidthEnd: ((e: TransitionEvent) => void) | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  const detachExpandTracking = () => {
    const el = shellEl;
    const handler = onMaxWidthEnd;
    shellEl = undefined;
    onMaxWidthEnd = undefined;
    if (el && handler) {
      el.removeEventListener('transitionend', handler);
    }
    if (fallbackTimer !== undefined) {
      globalThis.clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
  };

  const finishExpand = () => {
    detachExpandTracking();
    setPanelIsSlim(false);
  };

  onCleanup(detachExpandTracking);

  return {
    panelIsSlim,
    handleSidebarOpenChange(open: boolean) {
      detachExpandTracking();

      if (!open) {
        setPanelIsSlim(true);
        args.parentOnOpenChange(open);
        return;
      }

      args.parentOnOpenChange(open);

      requestAnimationFrame(() => {
        const el = args.getShell();
        if (!el) {
          setPanelIsSlim(false);
          return;
        }

        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName !== 'max-width' || e.target !== el) return;
          finishExpand();
        };

        shellEl = el;
        onMaxWidthEnd = onEnd;
        el.addEventListener('transitionend', onEnd);

        fallbackTimer = globalThis.setTimeout(
          finishExpand,
          SIDEBAR_MAX_WIDTH_TRANSITION_MS + 80
        );
      });
    },
  } as const;
}

type AppSidebarProps = {
  sidebarState?: SidebarState;
  onOpenChange: (open: boolean) => void;
};

type SidebarHotkeyDeps = {
  links: SidebarItem[];
  hotkeyVisible: () => boolean;
  setHotkeyVisible: (visible: boolean) => void;
  resetHotkeysState: VoidFunction;
  isSlim: () => boolean;
  onOpenChange: (open: boolean) => void;
  openWithSplit: ReturnType<typeof useSplitLayout>['openWithSplit'];
};

const registerSidebarHotkeys = ({
  links,
  isSlim,
  onOpenChange,
  openWithSplit,
  hotkeyVisible,
  setHotkeyVisible,
  resetHotkeysState,
}: SidebarHotkeyDeps) => {
  const debounceResetHotkeysState = debounce(resetHotkeysState, 2000);
  const debounceSetHotkeyVisible = debounce(() => setHotkeyVisible(true), 200);

  // Register 'g' as a leader key that activates the global GO_TO command scope
  registerHotkey({
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

  const registeredGoToKeys = new Set<ValidHotkey>([
    ...links.map((link) => link.hotkey),
  ]);

  // When the go to command scope is active, we want to prevent
  // other default hotkeys from running. So doing "g" + some key
  // not part of the sidebar hotkeys, won't fire the command
  // for the key
  useHotkeyInterceptor((context) => {
    // If a hotkey is going to be fired, but the hotkeys are not
    // visible, then it's not a sidebar nav hotkey and we can
    // ignore it and reset our visible state
    if (!hotkeyVisible()) {
      debounceSetHotkeyVisible.clear();
      return false;
    }

    if (context.eventType !== 'keydown') return false;

    if (
      context.activeScopeId !== GO_TO_COMMAND_SCOPE ||
      registeredGoToKeys.has(context.pressedKeysString)
    ) {
      return false;
    }

    resetHotkeysState();
    debounceResetHotkeysState.clear();

    return true;
  });

  registerHotkey({
    scopeId: 'global',
    hotkeyToken: TOKENS.global.inviteTeam,
    description: 'Send Invites',
    keyDownHandler: (e) => {
      e?.preventDefault();
      setInviteModalOpen(true);
      return true;
    },
  });

  registerHotkey({
    hotkey: 'cmd+.',
    scopeId: 'global',
    hotkeyToken: TOKENS.global.toggleSidebar,
    description: 'Toggle sidebar',
    runWithInputFocused: true,
    keyDownHandler: (e) => {
      e?.preventDefault();
      onOpenChange(isSlim());
      return true;
    },
  });

  // Register navigation shortcuts in the global GO_TO command scope
  for (const link of links) {
    const openSidebarView = (e?: KeyboardEvent) => {
      e?.preventDefault();
      if (hotkeyVisible()) {
        resetHotkeysState();
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

      const handle = openWithSplit(
        {
          type: 'component',
          id: link.id,
        },
        {
          preferNewSplit: e?.shiftKey,
          mergeHistory: false,
          allowDuplicate: true,
        }
      );
      if (link.id === 'search' && handle) {
        requestSearchFocus(handle.id);
      }
      return true;
    };

    registerHotkey({
      hotkey: link.hotkey,
      scopeId: link.standaloneHotkey ? 'global' : GO_TO_COMMAND_SCOPE,
      hotkeyToken: link.hotkeyToken,
      description: `Go to ${link.label}`,
      keyDownHandler: openSidebarView,
      icon: link.icon,
    });
  }
};

type SidebarActionButtonProps = {
  icon: Component<{ triggerAnimation?: boolean; class?: string }>;
  onClick: (event?: MouseEvent) => void;
  disabled?: boolean | (() => boolean);
  hotkeyToken?: HotkeyToken;
  isSlim: () => boolean;
  label: string;
};

type SidebarShortcutLinkProps = {
  label: string;
  icon: Component<{ triggerAnimation?: boolean; class?: string }>;
  onClick: () => void;
  isSlim: () => boolean;
};

const SidebarShortcutLink = (props: SidebarShortcutLinkProps) => {
  const [isHovering, setIsHovering] = createSignal(false);

  return (
    <Button
      draggable={false}
      variant="ghost"
      class={cn(
        'flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-md py-1 text-ink-extra-muted not-disabled:hover:bg-ink/3'
      )}
      tooltipPlacement="right"
      label={props.isSlim() ? props.label : undefined}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        props.onClick();
      }}
    >
      <div class="relative shrink-0 [&_svg]:size-4">
        <Dynamic component={props.icon} triggerAnimation={isHovering()} />
      </div>

      <div class="flex items-center gap-1 group-data-[slim=true]/sidebar:hidden">
        <span class="whitespace-nowrap">{props.label}</span>
      </div>
    </Button>
  );
};

type SettingsMenuItem = {
  tab: SettingsTab;
  label: string;
  description: string;
  icon: Component<{ class?: string }>;
};

const SETTINGS_MENU_TOP_ITEMS: SettingsMenuItem[] = [
  {
    tab: 'Mobile App',
    label: 'App',
    description: 'Get the mobile app',
    icon: DeviceMobileIcon,
  },
  {
    tab: 'Agent',
    label: 'MCPs',
    description: 'Agent connectors and MCP servers',
    icon: PlugIcon,
  },
  {
    tab: 'Team',
    label: 'Team',
    description: 'Members and invites',
    icon: UsersThreeIcon,
  },
];

const SETTINGS_MENU_BOTTOM_ITEMS: SettingsMenuItem[] = [
  {
    tab: 'Shortcuts',
    label: 'Shortcuts',
    description: 'Keyboard shortcuts',
    icon: KeyboardIcon,
  },
  {
    tab: 'Appearance',
    label: 'Appearance',
    description: 'Theme and UI customization',
    icon: PaintBucketIcon,
  },
  {
    tab: 'Account',
    label: 'Account',
    description: 'Profile, email, and subscription',
    icon: UserIconPhosphor,
  },
];

/**
 * Mirrors the gating in `Settings.tsx`'s `settingsTabs()`. Use to filter the
 * sidebar menu/shortcuts and to guard `setActiveTabId` callers so we never
 * activate a tab that the settings panel won't render.
 */
const useIsSettingsTabAvailable = () => {
  const teamsFlag = useFeatureFlag('enable-teams-settings', {
    enabledOverride: ENABLE_TEAMS_OVERRIDE,
  });

  return (tab: SettingsTab): boolean => {
    switch (tab) {
      case 'Appearance':
      case 'Account':
        return true;
      case 'Team':
        return teamsFlag().enabled;
      case 'Shortcuts':
        return !isTouchDevice();
      case 'Mobile App':
        return ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform();
      case 'Agent':
        return !isNativeMobilePlatform();
      case 'Mobile':
        return isNativeMobilePlatform() && DEV_MODE_ENV;
      default:
        return false;
    }
  };
};

/**
 * A normalised action button for the sidebar footer area.
 *
 * Mirrors the tooltip behaviour of `SidebarLink`:
 * - slim  → show tooltip (label + hotkey)
 * - expanded → no tooltip (label and hotkey badge are visible inline)
 */
const SidebarActionButton = (props: SidebarActionButtonProps) => {
  const [hovering, setHovering] = createSignal(false);

  const isDisabled = () =>
    typeof props.disabled === 'function'
      ? props.disabled()
      : (props.disabled ?? false);

  return (
    <Button
      class={cn(
        'flex items-center justify-start group-data-[slim=true]/sidebar:justify-center text-sm gap-2 cursor-default w-full rounded-md py-1 text-ink-extra-muted not-disabled:hover:bg-ink/3'
      )}
      variant="ghost"
      tooltipPlacement="right"
      label={props.isSlim() ? props.label : undefined}
      hotkey={props.isSlim() ? props.hotkeyToken : undefined}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
      }}
      onClick={(event: MouseEvent) => props.onClick(event)}
      disabled={isDisabled()}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div class="size-4 shrink-0">
        <Dynamic component={props.icon} triggerAnimation={hovering()} />
      </div>
      <span class="whitespace-nowrap group-data-[slim=true]/sidebar:hidden">
        {props.label}
      </span>
      <Show when={hovering() && props.hotkeyToken}>
        {(token) => (
          <div class="text-xxs text-ink-extra-muted/50 rounded-sm ml-auto border border-ink/5 px-1.5 py-px -my-1 group-data-[slim=true]/sidebar:hidden">
            <Hotkey token={token()} class="flex gap-1" />
          </div>
        )}
      </Show>
    </Button>
  );
};

type SidebarSettingsWidgetProps = {
  isSlim: () => boolean;
  onSelect: (tab: SettingsTab) => void;
  isTabAvailable: (tab: SettingsTab) => boolean;
};

const SidebarSettingsWidget = (props: SidebarSettingsWidgetProps) => {
  const userId = useUserId();

  const topItems = createMemo(() =>
    SETTINGS_MENU_TOP_ITEMS.filter((item) => props.isTabAvailable(item.tab))
  );
  const bottomItems = createMemo(() =>
    SETTINGS_MENU_BOTTOM_ITEMS.filter((item) => props.isTabAvailable(item.tab))
  );

  return (
    <Dropdown placement="top-start" gutter={6}>
      <Dropdown.Trigger
        variant="ghost"
        class={cn(
          'flex items-center w-full rounded-md cursor-default text-ink-extra-muted not-disabled:hover:bg-ink/3 h-9',
          'justify-start gap-2 px-1.5 py-1',
          'group-data-[slim=true]/sidebar:justify-center group-data-[slim=true]/sidebar:gap-0'
        )}
        label={props.isSlim() ? 'Settings' : undefined}
        tooltipPlacement="right"
        onMouseDown={(e: MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
        }}
      >
        <Show
          when={userId()}
          fallback={<div class="size-5 shrink-0 rounded-full bg-ink/10" />}
        >
          {(id) => (
            <div class="size-5">
              <UserIcon
                id={id()}
                size="fill"
                suppressClick
                showTooltip={false}
                // class="-m-1"
              />
            </div>
          )}
        </Show>
        <span class="flex-1 min-w-0 text-left whitespace-nowrap text-sm truncate group-data-[slim=true]/sidebar:hidden">
          Settings
        </span>
        <CaretUpIcon class="size-3 text-ink-extra-muted shrink-0 group-data-[slim=true]/sidebar:hidden" />
      </Dropdown.Trigger>
      <Dropdown.Content depth={3} class="min-w-56">
        <Dropdown.Group>
          <For each={topItems()}>
            {(item) => (
              <Dropdown.Item
                class="flex items-start gap-2 px-2.5 py-2.5 text-sm cursor-default outline-none text-ink-muted"
                onSelect={() => props.onSelect(item.tab)}
              >
                <span class="size-5 flex items-center justify-center">
                  <Dynamic
                    component={item.icon}
                    class="size-4 shrink-0 text-ink-extra-muted"
                  />
                </span>
                <div class="flex flex-col min-w-0">
                  <span class="text-ink">{item.label}</span>
                  <span class="text-xxs text-ink-extra-muted leading-tight">
                    {item.description}
                  </span>
                </div>
              </Dropdown.Item>
            )}
          </For>
          <Show when={topItems().length > 0 && bottomItems().length > 0}>
            <Dropdown.Separator />
          </Show>
          <For each={bottomItems()}>
            {(item) => (
              <Dropdown.Item
                class="flex items-start gap-2 px-2.5 py-2.5 text-sm cursor-default outline-none text-ink-muted"
                onSelect={() => props.onSelect(item.tab)}
              >
                <span class="size-5 flex items-center justify-center">
                  <Dynamic
                    component={item.icon}
                    class="size-4 shrink-0 text-ink-extra-muted"
                  />
                </span>
                <div class="flex flex-col min-w-0">
                  <span class="text-ink">{item.label}</span>
                  <span class="text-xxs text-ink-extra-muted leading-tight">
                    {item.description}
                  </span>
                </div>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};

const CALLS_LINK: SidebarItem = {
  id: 'calls',
  label: 'Calls',
  href: LIST_VIEW_PATHS.calls,
  icon: AnimatedCallIcon,
  hotkey: 'l',
  hotkeyToken: TOKENS.sidebar.goTo.calls,
};

export const AppSidebar = (props: AppSidebarProps) => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const { openSettings, setActiveTabId, settingsOpen } = useSettingsState();
  const isTabAvailable = useIsSettingsTabAvailable();
  const notificationSettings = useNotificationSettings();
  const callCtx = useCallContextOptional();

  const showEnableNotifications = () =>
    notificationSettings.isSupported && notificationSettings.canPrompt();

  const handleEnableNotifications = async () => {
    if (!notificationSettings.isSupported) return;
    try {
      await notificationSettings.toggle(true);
    } catch (error) {
      console.error('Failed to enable notifications:', error);
    }
  };

  const [hotkeyVisible, setHotkeyVisible] = createSignal(false);

  const visibleLinks = createMemo(() => {
    if (!ENABLE_CALLS()) return SIDEBAR_LINKS;
    const idx = SIDEBAR_LINKS.findIndex((l) => l.id === 'channels');
    return [
      ...SIDEBAR_LINKS.slice(0, idx + 1),
      CALLS_LINK,
      ...SIDEBAR_LINKS.slice(idx + 1),
    ];
  });

  const resetHotkeysState = () => {
    setHotkeyVisible(false);

    // To prevent the next key from triggering the hotkey handler,
    // we reset the pressed keys state and exit the command scope
    clearPressedKeys();
    activateClosestDOMScope();
  };

  const handleCommandPaletteClick = () => {
    if (!CommandState.isOpen()) {
      analytics.track('command_menu_open', { from: 'sidebar' });
    }
    CommandState.toggle();
  };

  const handleCreateClick = () => {
    const willOpen = !createMenuOpen();
    if (willOpen) {
      analytics.track('create_menu_open', { from: 'sidebar' });
    }
    setCreateMenuOpen((p) => !p);
  };

  const canCreateNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? true;

  const handleNewSplitClick = () => {
    const manager = globalSplitManager();
    if (!manager || !manager.canAppendSplit()) return;

    analytics.track('split_created', { from: 'sidebar' });
    manager.createNewSplit({
      content: {
        type: 'component',
        id: LIST_VIEW_ID.inbox,
      },
      activate: true,
      allowDuplicate: true,
      referredFrom: 'sidebar',
    });
  };

  const openSettingsTab = (tab: SettingsTab) => {
    if (!isTabAvailable(tab)) return;
    if (settingsOpen()) {
      setActiveTabId(tab);
      return;
    }
    if (globalSplitManager()?.canAppendSplit() ?? true) {
      setActiveTabId(tab);
      analytics.track('split_created', { from: 'sidebar' });
      layout.openWithSplit(
        { type: 'component', id: 'settings' },
        {
          referredFrom: 'sidebar',
          allowDuplicate: true,
          preferNewSplit: true,
          mergeHistory: false,
        }
      );
      return;
    }
    openSettings(tab);
  };

  const isExpanded = () => props.sidebarState === 'expanded';
  const isSlim = () => props.sidebarState === 'slim';

  let sidebarShell: HTMLDivElement | undefined;
  const { panelIsSlim, handleSidebarOpenChange } = createInCallPanelSlimToggle({
    initialSlim: isSlim(),
    parentOnOpenChange: props.onOpenChange,
    getShell: () => sidebarShell,
  });

  registerSidebarHotkeys({
    links: visibleLinks(),
    hotkeyVisible,
    setHotkeyVisible,
    resetHotkeysState,
    isSlim,
    onOpenChange: handleSidebarOpenChange,
    openWithSplit: layout.openWithSplit,
  });

  return (
    <div
      ref={(el) => {
        sidebarShell = el ?? undefined;
      }}
      class={cn(
        'group/sidebar h-full py-2 flex flex-col gap-0 mobile:absolute mobile:z-modal-content overflow-hidden',
        isExpanded() &&
          'max-w-49.75 w-full mobile:max-w-2/3 translate-x-0 opacity-100',
        props.sidebarState === 'hidden' &&
          '-translate-x-full overflow-hidden opacity-0',

        isSlim() && 'max-w-12 w-full mobile:max-w-2/3 translate-x-0 opacity-100'
      )}
      data-expanded={isExpanded()}
      data-slim={isSlim()}
      style={{ transition: SIDEBAR_MAX_WIDTH_TRANSITION_STYLE }}
    >
      <div class="flex items-center justify-between p-2 relative group-data-[slim=true]/sidebar:pr-2.25">
        <div class="flex items-center group/logo-area w-full group-data-[slim=true]/sidebar:justify-end">
          <div class="text-accent group-data-[slim=true]/sidebar:opacity-0 group-data-[slim=true]/sidebar:max-w-0 min-w-0 pl-1 group-data-[slim=true]/sidebar:pl-0">
            <LogoIcon class="size-6" />
          </div>
          <div class="grow shrink-10 min-w-0 group-data-[slim=true]/sidebar:hidden" />
          <Show when={isExpanded()}>
            <div class="flex items-center gap-1 mr-1">
              <Show when={showEnableNotifications()}>
                <Button
                  class="size-7 rounded-xs p-1 [&_svg]:size-4"
                  label="Enable Notifications"
                  onClick={handleEnableNotifications}
                >
                  <BellIcon class="size-4" />
                </Button>
              </Show>
              <Button
                class="size-7 rounded-xs p-1 [&_svg]:size-4"
                label="New Split"
                hotkey={TOKENS.global.createNewSplit}
                disabled={!canCreateNewSplit()}
                onClick={handleNewSplitClick}
              >
                <AnimatedNewSplitIcon />
              </Button>
              <Button
                class="size-7 rounded-xs p-1 [&_svg]:size-4"
                label="Command"
                hotkey={TOKENS.global.commandMenu}
                onClick={handleCommandPaletteClick}
              >
                <CommandKIcon />
              </Button>
            </div>
          </Show>
          <Button
            class="size-7 rounded-xs p-1 [&_svg]:size-4"
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
            }}
            onClick={() => {
              handleSidebarOpenChange(!isExpanded());
              globalSplitManager()?.returnFocus();
            }}
            label={isExpanded() ? 'Shrink Sidebar' : 'Expand Sidebar'}
            hotkey={TOKENS.global.toggleSidebar}
          >
            <SquareSidebarIcon />
          </Button>
        </div>
      </div>

      <div class="px-2">
        <hr class="border-transparent" />
      </div>

      <div class="w-full px-2 my-[4.5px]">
        <SidebarActionButton
          label="Create"
          hotkeyToken={TOKENS.global.createCommand}
          isSlim={isSlim}
          onClick={handleCreateClick}
          icon={() => <AnimatedPlusIcon class="size-4" />}
        />
      </div>

      <div class="px-2">
        <hr class="border-transparent mb-2" />
      </div>

      <nav>
        <ul class="size-full px-2 flex flex-col gap-1">
          <For each={visibleLinks()}>
            {(link) => (
              <li class="flex items-center justify-center">
                <SidebarLink
                  {...link}
                  sidebarState={props.sidebarState ?? 'expanded'}
                  hotkeyVisible={hotkeyVisible()}
                />
              </li>
            )}
          </For>
        </ul>
      </nav>

      <div class="px-2">
        <hr class="border-transparent my-2" />
      </div>

      <div class="block max-h-[clamp(10%,60%,20rem)]">
        <ChannelsUnreadWidget sidebarState={props.sidebarState ?? 'expanded'} />
      </div>

      <Show when={callCtx?.isInCall()}>
        <div class="px-2 mb-2 mt-auto" data-ui="in-call-panel">
          <InCallPanel isSlim={panelIsSlim} />
        </div>
      </Show>

      <div class={cn('px-2 w-full', !callCtx?.isInCall() && 'mt-auto')}>
        <hr class="border-transparent mb-2" />
      </div>

      <div class="w-full px-2 flex flex-col gap-1 mb-1">
        <Show when={isTabAvailable('Mobile App')}>
          <SidebarShortcutLink
            label="App"
            isSlim={isSlim}
            onClick={() => openSettingsTab('Mobile App')}
            icon={() => <DeviceMobileIcon class="size-4" />}
          />
        </Show>
        <Show when={isTabAvailable('Agent')}>
          <SidebarShortcutLink
            label="MCPs"
            isSlim={isSlim}
            onClick={() => openSettingsTab('Agent')}
            icon={() => <PlugIcon class="size-4" />}
          />
        </Show>
        <Show when={isTabAvailable('Team')}>
          <SidebarShortcutLink
            label="Team"
            isSlim={isSlim}
            onClick={() => openSettingsTab('Team')}
            icon={() => <UsersThreeIcon class="size-4" />}
          />
        </Show>
      </div>

      <div class="w-full px-2">
        <SidebarSettingsWidget
          isSlim={isSlim}
          onSelect={openSettingsTab}
          isTabAvailable={isTabAvailable}
        />
      </div>
      <InviteModal />
    </div>
  );
};

interface SidebarLinkProps extends SidebarItem {
  sidebarState: SidebarState;
  hotkeyVisible: boolean;
}

const SidebarLink = (props: SidebarLinkProps) => {
  const [isHovering, setIsHovering] = createSignal(false);

  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const layoutManager = globalSplitManager();

  const location = useLocation();

  const isActive = () => {
    const activeContent = layoutManager?.activeSplit()?.content();

    // In case we can't match on the active split, use the url path to determine
    // if this link is active
    if (!activeContent) {
      const paths = location.pathname.split('/').filter(Boolean);
      return paths.includes(props.id);
    }

    return activeContent?.id === props.id;
  };

  const content = () =>
    ({
      type: 'component',
      id: props.id,
    }) as const;

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? true;

  const openInCurrentSplit = () =>
    layout.openWithSplit(content(), {
      allowDuplicate: true,
      mergeHistory: false,
      referredFrom: 'sidebar',
    });

  const openInNewSplit = () => {
    const manager = globalSplitManager();
    if (!manager || !manager.canAppendSplit()) return;

    analytics.track('split_created', { from: 'sidebar' });

    manager.createNewSplit({
      content: content(),
      activate: true,
      allowDuplicate: true,
      referredFrom: 'sidebar',
    });
  };

  const openFullscreen = () => {
    const split = openInCurrentSplit();
    split?.toggleSpotlight(true);
  };

  return (
    <ContextMenu>
      <ContextMenu.Trigger class="w-full">
        <Button
          draggable={false}
          variant="ghost"
          data-sidebar-link={props.id}
          data-active={isActive() ? '' : undefined}
          class={cn(
            'flex items-center justify-start group-data-[slim=true]/sidebar:justify-center text-sm gap-2 cursor-default w-full rounded-md py-1 text-ink-extra-muted not-disabled:hover:bg-ink/3',
            isActive() && 'bg-ink/6 not-disabled:hover:bg-ink/6 text-ink'
          )}
          tooltipPlacement="right"
          onMouseEnter={() => setIsHovering(true)}
          label={
            props.sidebarState === 'slim' ? `Go to ${props.label}` : undefined
          }
          hotkey={
            props.sidebarState === 'slim'
              ? props.standaloneHotkey
                ? props.hotkeyToken
                : [TOKENS.sidebar.goToLeader, props.hotkeyToken]
              : undefined
          }
          onMouseLeave={() => setIsHovering(false)}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            analytics.track('sidebar_click', {
              view: props.id,
            });

            e.preventDefault();
            let currentContentHandle = layoutManager?.activeSplit();

            const currentContent = currentContentHandle?.content();
            const isSameContent =
              currentContent?.type === 'component' &&
              currentContent?.id === props.id;

            if (!isSameContent || e.shiftKey) {
              currentContentHandle = layout.openWithSplit(content(), {
                preferNewSplit: e.shiftKey,
                mergeHistory: false,
                allowDuplicate: true,
                referredFrom: 'sidebar',
              });
            }

            if (props.id === 'search' && currentContentHandle) {
              requestSearchFocus(currentContentHandle.id);
            }

            layoutManager?.returnFocus();
          }}
        >
          <Show when={props.icon}>
            <div class="shrink-0 [&_svg]:size-4">
              <Dynamic component={props.icon} triggerAnimation={isHovering()} />
            </div>
          </Show>

          <div class="flex items-center gap-1 group-data-[slim=true]/sidebar:hidden">
            <span class="whitespace-nowrap">{props.label}</span>
          </div>

          <Show when={isHovering() && !props.hotkeyVisible}>
            <div class="group-data-[slim=true]/sidebar:hidden ml-auto">
              <div class="flex gap-1 items-center text-ink-extra-muted font-normal text-xxs">
                <Show when={!props.standaloneHotkey}>
                  <div class="text-xxs text-ink-extra-muted rounded-sm ml-auto border border-ink/5 px-1.5 py-0.5 -my-1">
                    <Hotkey token={TOKENS.sidebar.goToLeader} />
                  </div>
                  <div class="text-xxs text-ink-extra-muted rounded-sm ml-auto border border-ink/5 px-1.5 py-0.5 -my-1">
                    <Hotkey token={props.hotkeyToken} />
                  </div>
                </Show>
                <Show when={props.standaloneHotkey}>
                  <div class="text-xxs text-ink-extra-muted rounded-sm ml-auto border border-ink/5 px-1.5 py-0.5 -my-1">
                    <Hotkey token={props.hotkeyToken} />
                  </div>
                </Show>
              </div>
            </div>
          </Show>
          <Show when={props.hotkeyVisible}>
            <div
              class={cn(
                'text-xs size-4 rounded-xs flex items-center justify-center overflow-hidden bg-accent/10 border border-accent/30 text-accent',
                props.sidebarState === 'slim' && 'absolute -bottom-1 -right-1',
                props.sidebarState !== 'slim' && 'relative p-1 ml-auto'
              )}
            >
              <Hotkey token={props.hotkeyToken} />
            </div>
          </Show>
        </Button>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenuContent class="text-xs text-ink-muted">
          <MenuItem
            text="Open in new split"
            onClick={openInNewSplit}
            disabled={!canOpenInNewSplit()}
          />
          <MenuItem text="Open fullscreen" onClick={openFullscreen} />
          <MenuItem text="Open in current split" onClick={openInCurrentSplit} />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
};
