import { useAnalytics } from '@app/component/analytics-context';
import { SidebarActiveCallWidget } from '@app/component/app-sidebar/active-call-widget';
import { ChannelsUnreadWidget } from '@app/component/app-sidebar/channels-unread-widget';
import {
  InviteModal,
  setInviteModalOpen,
} from '@app/component/app-sidebar/invite-modal';
import {
  SidebarPromoCard,
  SidebarPromoHint,
} from '@app/component/app-sidebar/sidebar-promo';
import { CommandState } from '@app/component/command';
import { InteractiveOnboardingModal } from '@app/component/interactive-onboarding/InteractiveOnboardingModal';
import { createMenuOpen, setCreateMenuOpen } from '@app/component/Launcher';
import { getDocumentsFilterSplit } from '@app/component/next-soup/soup-view/documents-filter-controllers';
import {
  getInboxFilterSplit,
  INBOX_FILTER_ENTRY_KEY,
  requestInboxFilter,
} from '@app/component/next-soup/soup-view/inbox-filter-controllers';
import { requestSearchFocus } from '@app/component/next-soup/soup-view/search-controllers';
import { useSplitLayout } from '@app/component/split-layout/layout';
import type {
  ReferredFrom,
  SplitContent,
  SplitHandle,
} from '@app/component/split-layout/layoutManager';
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
import { useHasPaidAccess } from '@core/auth';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import {
  ENABLE_CALLS,
  ENABLE_CRM,
  ENABLE_HOME_OVERRIDE,
  ENABLE_NEW_PRICING_OVERRIDE,
} from '@core/constant/featureFlags';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import {
  getSettingsTabItem,
  useSettingsTabAvailable,
  useSettingsTabs,
} from '@core/constant/settingsTabsConfig';
import { useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { clearPressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import LogoIcon from '@icon/macro-logo.svg';
import { AnimatedSquareCommandKIcon } from '@icon/square-command-k';
import { AnimatedSquareSidebarIcon } from '@icon/square-sidebar';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedCompanyIcon } from '@icon/wide-company';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedNewSplitIcon } from '@icon/wide-newSplit';
import { AnimatedPlusIcon } from '@icon/wide-plus';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import { ContextMenu } from '@kobalte/core/context-menu';
import { useNotificationSettings } from '@notifications';
import BellIcon from '@phosphor/bell.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import HomeIcon from '@phosphor/house.svg';
import PlayIcon from '@phosphor/play.svg';
import { useEmailLinksQuery } from '@queries/email/link';
import { debounce } from '@solid-primitives/scheduled';
import { makePersisted } from '@solid-primitives/storage';
import { useLocation } from '@solidjs/router';
import { Button, cn, Dropdown, Hotkey, NavRow } from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

interface SidebarItem {
  id: ListView | (string & {});
  label: string;
  href: string;
  params?: Record<string, unknown>;
  icon?: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
  >;
  hotkey: ValidHotkey;
  hotkeyToken: HotkeyToken;
  standaloneHotkey?: boolean;
  hiddenFromSidebar?: boolean;
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
      initialFilters: { include: { fileAssoc: ['assoc:md'] } },
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
    id: 'channels',
    label: 'Channels',
    href: LIST_VIEW_PATHS.channels,
    icon: AnimatedChannelIcon,
    hotkey: 'c',
    hotkeyToken: TOKENS.sidebar.goTo.channels,
  },
  ...(ENABLE_CRM
    ? ([
        {
          id: 'companies',
          label: 'Companies',
          href: LIST_VIEW_PATHS.companies,
          icon: AnimatedCompanyIcon,
          hotkey: 'o',
          hotkeyToken: TOKENS.sidebar.goTo.companies,
        },
      ] satisfies SidebarItem[])
    : []),
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
  links: () => SidebarItem[];
  hotkeyVisible: () => boolean;
  setHotkeyVisible: (visible: boolean) => void;
  resetHotkeysState: VoidFunction;
  isSlim: () => boolean;
  onOpenChange: (open: boolean) => void;
  openWithSplit: ReturnType<typeof useSplitLayout>['openWithSplit'];
};

type OpenWithSplitFn = ReturnType<typeof useSplitLayout>['openWithSplit'];

const isComponentEntry =
  (id: string) =>
  (entry: SplitContent): boolean =>
    entry.type === 'component' && entry.id === id;

const isMarkdownDocumentsParams = (
  params: SidebarItem['params'] | undefined
): boolean => {
  const initialClientFilters = params?.initialClientFilters as
    | { or?: readonly unknown[] }
    | undefined;

  return initialClientFilters?.or?.includes('doc-markdown') ?? false;
};

/**
 * Navigate to a sidebar view, preserving prior state when possible.
 *
 * If the active split's history already contains an entry for this view, jump
 * back to it so search text, filters, preview state, etc. are restored from
 * that entry. Otherwise push a fresh entry. Holding shift bypasses the lookup
 * and forces a new entry / new split.
 */
function navigateToSidebarView(args: {
  viewId: SidebarItem['id'];
  params?: SidebarItem['params'];
  shiftKey: boolean;
  activeSplit: SplitHandle | undefined;
  openWithSplit: OpenWithSplitFn;
  referredFrom?: ReferredFrom;
}): SplitHandle | undefined {
  const { viewId, params, shiftKey, activeSplit, openWithSplit, referredFrom } =
    args;

  const activeContent = activeSplit?.content();
  if (
    !shiftKey &&
    isMarkdownDocumentsParams(params) &&
    activeContent?.type === 'component' &&
    activeContent.id === 'documents'
  ) {
    const controller = activeSplit
      ? getDocumentsFilterSplit(activeSplit.id)
      : undefined;
    if (controller) {
      controller.toggleMarkdownFilter();
      return activeSplit;
    }
  }

  if (
    !params &&
    !shiftKey &&
    activeSplit?.goToEntry(isComponentEntry(viewId))
  ) {
    return activeSplit;
  }

  return openWithSplit(
    { type: 'component', id: viewId, params },
    {
      preferNewSplit: shiftKey,
      mergeHistory: false,
      allowDuplicate: true,
      referredFrom,
    }
  );
}

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

  const registeredGoToKeys = () =>
    new Set<ValidHotkey>(links().map((link) => link.hotkey));

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
      registeredGoToKeys().has(context.pressedKeysString)
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

  // Register navigation shortcuts in the global GO_TO command scope.
  // This must be reactive because prod feature flags can add links after the
  // initial render (e.g. Home), and Hotkey UI resolves tokens from the registry.
  createEffect(() => {
    const disposers = links().map((link) => {
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

        const handle = navigateToSidebarView({
          viewId: link.id,
          params: link.params,
          shiftKey: !!e?.shiftKey,
          activeSplit: globalSplitManager()?.activeSplit(),
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
};

/** Session-only signal so a hint shows after dismissal until the user acknowledges or the timer expires. */
const [premiumHintVisible, setPremiumHintVisible] = createSignal(false);

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
    <NavRow
      draggable={false}
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
    </NavRow>
  );
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
    <NavRow
      class="group-data-[slim=true]/sidebar:justify-center"
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
    </NavRow>
  );
};

/**
 * Compact icon-only button for the sidebar header row. Encapsulates the hover
 * signal so animated icons play on hover, mirroring `SidebarActionButton`.
 */
const SidebarHeaderIconButton = (props: {
  icon: Component<{ triggerAnimation?: boolean; class?: string }>;
  label: string;
  hotkey?: HotkeyToken | HotkeyToken[];
  disabled?: boolean;
  onClick: (event: MouseEvent) => void;
  onMouseDown?: (event: MouseEvent) => void;
}) => {
  const [hovering, setHovering] = createSignal(false);
  return (
    <Button
      class="rounded-md p-1 text-ink-extra-muted [&_svg]:size-4"
      size="icon-sm"
      label={props.label}
      hotkey={props.hotkey}
      disabled={props.disabled}
      onClick={props.onClick}
      onMouseDown={props.onMouseDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Dynamic component={props.icon} triggerAnimation={hovering()} />
    </Button>
  );
};

type SidebarSettingsWidgetProps = {
  isSlim: () => boolean;
  onSelect: (tab: SettingsTab) => void;
};

const SidebarSettingsWidget = (props: SidebarSettingsWidgetProps) => {
  const userId = useUserId();
  const [onboardingModalOpen, setOnboardingModalOpen] = createSignal(false);
  const { groups: settingGroups } = useSettingsTabs();

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
      <Dropdown.Content>
        <Dropdown.Group>
          <Dropdown.Item
            class="flex items-center gap-2 px-2.5 py-2 text-sm cursor-default outline-none text-ink-muted"
            onSelect={() => setOnboardingModalOpen(true)}
          >
            <span class="size-5 flex items-center justify-center">
              <PlayIcon class="size-4 shrink-0 text-ink-extra-muted" />
            </span>
            <span class="text-ink">Play tutorial</span>
          </Dropdown.Item>
        </Dropdown.Group>
        <For each={settingGroups()}>
          {(group) => (
            <Dropdown.Group>
              <For each={group.items}>
                {(item) => (
                  <Dropdown.Item
                    class="flex items-center gap-2 px-2.5 py-2 text-sm cursor-default outline-none text-ink-muted"
                    onSelect={() => props.onSelect(item.tab)}
                  >
                    <span class="size-5 flex items-center justify-center">
                      <Dynamic
                        component={item.icon}
                        class="size-4 shrink-0 text-ink-extra-muted"
                      />
                    </span>
                    <span class="text-ink">{item.label}</span>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          )}
        </For>
      </Dropdown.Content>
      <InteractiveOnboardingModal
        open={onboardingModalOpen()}
        onOpenChange={setOnboardingModalOpen}
      />
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

const DASHBOARD_LINK: SidebarItem = {
  id: 'home',
  label: 'Home',
  href: '/home',
  icon: HomeIcon,
  hotkey: 'h',
  hotkeyToken: TOKENS.sidebar.goTo.home,
};

/**
 * Settings tabs surfaced as always-visible quick links above the settings
 * widget. Label/icon come from the settings tab config (see
 * `getSettingsTabItem`); this list only decides which tabs to promote.
 */
const PROMOTED_SETTINGS_TABS: SettingsTab[] = ['Mobile App', 'Agent', 'Team'];

export const AppSidebar = (props: AppSidebarProps) => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const { openSettings, setActiveTabId, settingsOpen } = useSettingsState();
  const isTabAvailable = useSettingsTabAvailable();
  const notificationSettings = useNotificationSettings();
  const callCtx = useCallContextOptional();

  const homeViewEnabled = useFeatureFlag('enable-home-view', {
    enabledOverride: ENABLE_HOME_OVERRIDE,
  });

  const hasPaidAccess = useHasPaidAccess();

  /** Persisted dismissal for the Premium upgrade promo card. */
  const [premiumCardDismissed, setPremiumCardDismissed] = makePersisted(
    createSignal<boolean>(false),
    { name: 'sidebar-premium-card-dismissed' }
  );

  const newPricingFF = useFeatureFlag('enable-new-pricing', {
    enabledOverride: ENABLE_NEW_PRICING_OVERRIDE,
  });

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

  const visibleLinks = createMemo((): SidebarItem[] => {
    let links: SidebarItem[] = [...SIDEBAR_LINKS];

    if (homeViewEnabled().enabled) {
      links = [DASHBOARD_LINK, ...links];
    }

    if (ENABLE_CALLS()) {
      const idx = links.findIndex((l) => l.id === 'channels');
      links = [...links.slice(0, idx + 1), CALLS_LINK, ...links.slice(idx + 1)];
    }

    return links.filter((link) => !link.hiddenFromSidebar);
  });

  const hotkeyLinks = createMemo((): SidebarItem[] => {
    let links: SidebarItem[] = [...SIDEBAR_LINKS];

    if (homeViewEnabled().enabled) {
      links = [DASHBOARD_LINK, ...links];
    }

    if (ENABLE_CALLS()) {
      const idx = links.findIndex((l) => l.id === 'channels');
      links = [...links.slice(0, idx + 1), CALLS_LINK, ...links.slice(idx + 1)];
    }

    return links;
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
    links: hotkeyLinks,
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
                  class="rounded-md p-1 text-ink-extra-muted"
                  size="icon-sm"
                  label="Enable Notifications"
                  onClick={handleEnableNotifications}
                >
                  <BellIcon />
                </Button>
              </Show>
              <SidebarHeaderIconButton
                label="Command"
                hotkey={TOKENS.global.commandMenu}
                onClick={handleCommandPaletteClick}
                icon={AnimatedSquareCommandKIcon}
              />
              <SidebarHeaderIconButton
                label="New Split"
                hotkey={TOKENS.global.createNewSplit}
                disabled={!canCreateNewSplit()}
                onClick={handleNewSplitClick}
                icon={AnimatedNewSplitIcon}
              />
            </div>
          </Show>
          <SidebarHeaderIconButton
            label={isExpanded() ? 'Shrink Sidebar' : 'Expand Sidebar'}
            hotkey={TOKENS.global.toggleSidebar}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
            }}
            onClick={() => {
              handleSidebarOpenChange(!isExpanded());
              globalSplitManager()?.returnFocus();
            }}
            icon={AnimatedSquareSidebarIcon}
          />
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
              <li class="flex flex-col items-center justify-center">
                <Dynamic
                  component={link.id === 'mail' ? SidebarMailLink : SidebarLink}
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

      <div class="mt-auto">
        <Show when={ENABLE_CALLS()}>
          <div class="block max-h-[clamp(10%,60%,20rem)]">
            <SidebarActiveCallWidget
              sidebarState={props.sidebarState ?? 'expanded'}
            />
          </div>
        </Show>

        <Show when={callCtx?.isInCall()}>
          <div class="px-2 mb-2" data-ui="in-call-panel">
            <InCallPanel isSlim={panelIsSlim} />
          </div>
        </Show>
      </div>

      <div class="px-2 w-full">
        <hr class="border-transparent mb-2" />
      </div>

      <Show
        when={
          !hasPaidAccess() &&
          !isSlim() &&
          !premiumCardDismissed() &&
          newPricingFF().enabled
        }
      >
        <div class="w-full px-2 mb-2">
          <SidebarPromoCard
            label="Upgrade to Premium"
            description="Unlock MCP integrations, better AI models, and team collaboration."
            onDismiss={() => {
              setPremiumCardDismissed(true);
              setPremiumHintVisible(true);
            }}
            primaryAction={{
              label: 'Upgrade',
              onClick: () => openSettingsTab('Account'),
            }}
            secondaryAction={{
              label: 'Later',
              onClick: () => {
                setPremiumCardDismissed(true);
                setPremiumHintVisible(true);
              },
            }}
          />
        </div>
      </Show>
      <Show
        when={
          !hasPaidAccess() &&
          !isSlim() &&
          premiumHintVisible() &&
          premiumCardDismissed() &&
          newPricingFF().enabled
        }
      >
        <div class="w-full px-2 mb-2">
          <SidebarPromoHint
            title="Maybe later"
            message="You can upgrade anytime from Account settings."
            onDone={() => setPremiumHintVisible(false)}
            secondaryAction={{
              label: 'Take me there',
              onClick: () => openSettingsTab('Account'),
            }}
          />
        </div>
      </Show>

      <div class="w-full px-2 flex flex-col gap-1 mb-1">
        <For each={PROMOTED_SETTINGS_TABS}>
          {(tab) => (
            <Show
              when={isTabAvailable(tab) ? getSettingsTabItem(tab) : undefined}
            >
              {(item) => (
                <SidebarShortcutLink
                  label={item().label}
                  isSlim={isSlim}
                  onClick={() => openSettingsTab(tab)}
                  icon={item().icon}
                />
              )}
            </Show>
          )}
        </For>
      </div>

      <div class="w-full px-2">
        <SidebarSettingsWidget isSlim={isSlim} onSelect={openSettingsTab} />
      </div>
      <InviteModal />
    </div>
  );
};

interface SidebarLinkProps extends SidebarItem {
  sidebarState: SidebarState;
  hotkeyVisible: boolean;
  /**
   * Skip the active background/text even when the view is active — used when
   * a nested row (e.g. a single selected inbox) carries the highlight instead.
   */
  suppressActiveStyle?: boolean;
  /** Called when the link is clicked while its view is already active. */
  onActiveClick?: () => void;
  /**
   * Rendered at the link's right edge while the view is active, in place of
   * the hover hotkey hints (the shortcut is redundant once active) — e.g. the
   * Email link's expand chevron.
   */
  trailingWhenActive?: JSX.Element;
}

const SidebarLink = (props: SidebarLinkProps) => {
  const [isHovering, setIsHovering] = createSignal(false);

  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const location = useLocation();

  // Always read the manager signal live: it is undefined until the split
  // layout mounts, which happens after the sidebar.
  const isActive = () => {
    const activeContent = globalSplitManager()?.activeSplit()?.content();

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
      params: props.params,
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
        <NavRow
          draggable={false}
          data-sidebar-link={props.id}
          data-active={isActive() ? '' : undefined}
          active={isActive() && !props.suppressActiveStyle}
          class="group-data-[slim=true]/sidebar:justify-center"
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
            let currentContentHandle = globalSplitManager()?.activeSplit();

            const currentContent = currentContentHandle?.content();
            const isSameContent =
              currentContent?.type === 'component' &&
              currentContent?.id === props.id;

            if (!isSameContent || e.shiftKey) {
              currentContentHandle = navigateToSidebarView({
                viewId: props.id,
                params: props.params,
                shiftKey: e.shiftKey,
                activeSplit: currentContentHandle,
                openWithSplit: layout.openWithSplit,
                referredFrom: 'sidebar',
              });
            } else {
              props.onActiveClick?.();
            }

            if (props.id === 'search' && currentContentHandle) {
              requestSearchFocus(currentContentHandle.id);
            }

            globalSplitManager()?.returnFocus();
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

          <Show
            when={
              isActive() &&
              props.trailingWhenActive !== undefined &&
              !props.hotkeyVisible
            }
          >
            <div class="group-data-[slim=true]/sidebar:hidden ml-auto flex items-center text-ink-muted">
              {props.trailingWhenActive}
            </div>
          </Show>

          <Show
            when={
              isHovering() &&
              !props.hotkeyVisible &&
              !(isActive() && props.trailingWhenActive !== undefined)
            }
          >
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
        </NavRow>
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

/**
 * The Email sidebar link, acting as a dropdown for the user's linked inboxes.
 * With multiple inboxes linked, the active link swaps its hotkey hint for a
 * chevron; clicking the already-active link fans out a nested row per inbox,
 * and clicking it again collapses the rows and returns to the unified inbox
 * (all inboxes).
 *
 * The open/closed state is a plain user toggle, persisted across reloads —
 * navigating to other views or into an email block never collapses the rows.
 *
 * Clicking an inbox row scopes the email list to only that inbox (the same
 * `inboxFilter` the topbar inbox dropdown drives), navigating back to the
 * list first if some other view is active. A row carries the active highlight
 * only when it is the single selected inbox (read from the live mail view, or
 * from the filter its history entry captured when something else is on top),
 * in which case the parent link yields its own.
 */
const SidebarMailLink = (props: SidebarLinkProps) => {
  const layout = useSplitLayout();
  const linksQuery = useEmailLinksQuery();
  const [expanded, setExpanded] = makePersisted(createSignal(false), {
    name: 'sidebar-mail-accounts-expanded',
  });

  const links = createMemo(() =>
    [...(linksQuery.data?.links ?? [])].sort((a, b) =>
      a.email_address.localeCompare(b.email_address)
    )
  );

  const isMailList = (content: SplitContent | undefined) =>
    content?.type === 'component' && content.id === 'mail';

  const canShow = () => props.sidebarState === 'expanded' && links().length > 1;

  const showAccounts = () => canShow() && expanded();

  const selectedIds = () => {
    // Read the manager signal live: it is undefined until the split layout
    // mounts, which can be after the sidebar.
    const split = globalSplitManager()?.activeSplit();
    if (!split) return undefined;
    // Registered only while the split's mail list view is mounted.
    const controller = getInboxFilterSplit(split.id);
    if (controller) return controller.inboxFilter();
    // Something else is on top (an email block, another view) — read the
    // filter the mail list captured into its history entry on nav-away.
    const entries = split.history();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (isMailList(entry)) {
        return entry.state?.[INBOX_FILTER_ENTRY_KEY] as string[] | undefined;
      }
    }
    return undefined;
  };

  const onlySelectedId = () => {
    const ids = selectedIds();
    return ids?.length === 1 ? ids[0] : undefined;
  };

  // Scope the list to one inbox, first returning to the mail list (restoring
  // the history entry if there is one) when some other view is active. The
  // filter request is queued and applied as the list mounts.
  const selectOnly = (linkId: string) => {
    const manager = globalSplitManager();
    let split = manager?.activeSplit();
    if (!isMailList(split?.content())) {
      split = navigateToSidebarView({
        viewId: 'mail',
        shiftKey: false,
        activeSplit: split,
        openWithSplit: layout.openWithSplit,
        referredFrom: 'sidebar',
      });
    }
    if (!split) return;
    requestInboxFilter(split.id, [linkId]);
    manager?.returnFocus();
  };

  return (
    <>
      <SidebarLink
        {...props}
        suppressActiveStyle={showAccounts() && onlySelectedId() !== undefined}
        onActiveClick={() => {
          if (!canShow()) return;
          if (!expanded()) {
            setExpanded(true);
            return;
          }
          // Collapsing also returns to the unified inbox. Only fired while
          // the mail list is the active content, so target the active split.
          setExpanded(false);
          const split = globalSplitManager()?.activeSplit();
          if (split) requestInboxFilter(split.id, undefined);
        }}
        trailingWhenActive={
          canShow() ? (
            <CaretDownIcon
              class={cn(
                'size-3 transition-transform duration-200',
                expanded() && 'rotate-180'
              )}
            />
          ) : undefined
        }
      />
      <Show when={canShow()}>
        <div
          class="grid w-full transition-[grid-template-rows] duration-200 ease-out"
          style={{ 'grid-template-rows': expanded() ? '1fr' : '0fr' }}
        >
          <ul class="min-h-0 overflow-hidden flex flex-col gap-1">
            <For each={links()}>
              {(link, index) => (
                <li
                  class={cn(
                    'flex items-center justify-center first:mt-1 transition-[opacity,transform] duration-200 ease-out',
                    expanded()
                      ? 'opacity-100 translate-y-0'
                      : 'opacity-0 -translate-y-2'
                  )}
                  style={{
                    'transition-delay': expanded()
                      ? `${index() * 30}ms`
                      : '0ms',
                  }}
                >
                  <Button
                    draggable={false}
                    variant="ghost"
                    disabled={!expanded()}
                    data-sidebar-mail-account={link.email_address}
                    data-active={onlySelectedId() === link.id ? '' : undefined}
                    class={cn(
                      'flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-md py-1 pl-6 text-ink-extra-muted not-disabled:hover:bg-ink/3',
                      onlySelectedId() === link.id &&
                        'bg-ink/6 not-disabled:hover:bg-ink/6 text-ink'
                    )}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      selectOnly(link.id);
                    }}
                  >
                    <UserIcon
                      {...inboxIconProps(link.email_address)}
                      photoUrl={link.photo_url ?? undefined}
                      size="sm"
                      suppressClick
                      showTooltip={false}
                    />
                    <span class="truncate">{link.email_address}</span>
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </>
  );
};
