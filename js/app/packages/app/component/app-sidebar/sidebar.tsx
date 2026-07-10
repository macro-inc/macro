import { useAnalytics } from '@app/component/analytics-context';
import { ChannelsUnreadWidget } from '@app/component/app-sidebar/channels-unread-widget';
import {
  CollapsibleSidebarSection,
  type CollapsibleSidebarSectionItem,
} from '@app/component/app-sidebar/collapsible-sidebar-section';
import { FavoritesSection } from '@app/component/app-sidebar/favorites-section';
import {
  InviteModal,
  setInviteModalOpen,
} from '@app/component/app-sidebar/invite-modal';
import { SidebarCreateMenu } from '@app/component/app-sidebar/sidebar-create-menu';
import {
  SidebarPromoCard,
  SidebarPromoHint,
} from '@app/component/app-sidebar/sidebar-promo';
import { CommandState } from '@app/component/command';
import { buildDocumentTypeQuery } from '@app/component/next-soup/filters/configs/document-type-query';
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
import { LIST_VIEW_PATHS, type ListView } from '@app/constants/list-views';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useHasPaidAccess } from '@core/auth';
import { useLogout } from '@core/auth/logout';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import {
  ENABLE_CALLS,
  ENABLE_CRM,
  ENABLE_NEW_PRICING_OVERRIDE,
} from '@core/constant/featureFlags';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import {
  getSettingsTabItem,
  useSettingsTabAvailable,
} from '@core/constant/settingsTabsConfig';
import { useAuthor, useEmail, useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { clearPressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import LogoIcon from '@icon/macro-logo.svg';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedCompanyIcon } from '@icon/wide-company';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import { ContextMenu } from '@kobalte/core/context-menu';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import GearIcon from '@phosphor/gear.svg';
import HomeIcon from '@phosphor/house.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import SignOutIcon from '@phosphor/sign-out.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { useEmailLinksQuery } from '@queries/email/link';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createElementSize } from '@solid-primitives/resize-observer';
import { debounce } from '@solid-primitives/scheduled';
import { makePersisted } from '@solid-primitives/storage';
import { useLocation } from '@solidjs/router';
import { Button, cn, Dropdown, Hotkey, NavRow } from '@ui';
import {
  type Component,
  type ComponentProps,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  Suspense,
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

type SidebarSectionLinkId =
  | 'mail'
  | 'channels'
  | 'calls'
  | 'documents'
  | 'tasks'
  | 'agents'
  | 'companies';

type SidebarSectionVisibility = Record<SidebarSectionLinkId, boolean>;

type TryItemId = 'connect' | 'invite' | 'mobile';

type TryItemVisibility = Record<TryItemId, boolean>;

const COMMUNICATIONS_LINK_IDS = ['mail', 'channels', 'calls'] as const;
const WORKSPACE_LINK_IDS = [
  'documents',
  'tasks',
  'agents',
  'companies',
] as const;

const DEFAULT_SECTION_VISIBILITY: SidebarSectionVisibility = {
  mail: true,
  channels: true,
  calls: true,
  documents: true,
  tasks: true,
  agents: true,
  companies: true,
};

const DEFAULT_TRY_VISIBILITY: TryItemVisibility = {
  connect: true,
  invite: true,
  mobile: true,
};

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
const SIDEBAR_MAX_WIDTH_TRANSITION_MS = 120;
const SIDEBAR_MAX_WIDTH_TRANSITION_STYLE = [
  `max-width ease-in-out ${SIDEBAR_MAX_WIDTH_TRANSITION_MS}ms`,
  `width ease-in-out ${SIDEBAR_MAX_WIDTH_TRANSITION_MS}ms`,
  `opacity ease-in-out ${SIDEBAR_MAX_WIDTH_TRANSITION_MS}ms`,
  `transform ease-in-out ${SIDEBAR_MAX_WIDTH_TRANSITION_MS}ms`,
].join(', ');

type AppSidebarProps = {
  sidebarState?: SidebarState;
  onOpenChange: (open: boolean) => void;
  overlayOpen?: boolean;
  onOverlayOpenChange?: (open: boolean) => void;
};

type SidebarHotkeyDeps = {
  isSlim: () => boolean;
  onOpenChange: (open: boolean) => void;
};

type OpenWithSplitFn = ReturnType<typeof useSplitLayout>['openWithSplit'];

const isMarkdownDocumentsParams = (
  params: SidebarItem['params'] | undefined
): boolean => {
  const initialClientFilters = params?.initialClientFilters as
    | { or?: readonly unknown[] }
    | undefined;

  return initialClientFilters?.or?.includes('doc-markdown') ?? false;
};

/**
 * Navigate to a sidebar view by pushing a fresh entry into the active split.
 * Holding shift opens it in a new split. Use in-app back/forward to return to
 * prior entries.
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
  isSlim,
  onOpenChange,
}: SidebarHotkeyDeps) => {
  // Scoped to the sidebar's lifecycle on purpose: it toggles sidebar +
  // side-panel state, which is force-hidden (and thus a no-op) on full-cover
  // routes like solo settings, where `AppSidebar` unmounts. Genuinely global
  // shortcuts that must survive those routes live in `GoToHotkeys` instead.
  registerHotkey({
    hotkey: 'cmd+.',
    scopeId: 'global',
    hotkeyToken: TOKENS.global.toggleSidebar,
    description: 'Toggle sidebar',
    runWithInputFocused: true,
    keyDownHandler: (e) => {
      e?.preventDefault();
      const show = isSlim();
      onOpenChange(show);
      return true;
    },
  });
};

/**
 * Whether the "g" leader key is currently awaiting a destination key. Lives
 * at module scope so it can drive the hint overlay on `AppSidebar`'s nav
 * icons even though the registration below is owned by `GoToHotkeys`, which
 * stays mounted regardless of whether the sidebar itself is visible.
 */
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
 * "go to" nav hotkeys (e.g. "g i" for inbox), plus Send Invites. Rendered
 * unconditionally from `Layout` — unlike `AppSidebar`, which unmounts on those
 * routes — so none of them go dead there.
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

  const links = createMemo((): SidebarItem[] => buildSidebarLinks());

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
    new Set<ValidHotkey>(links().map((link) => link.hotkey));

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

  return null;
};

/** Session-only signal so a hint shows after dismissal until the user acknowledges or the timer expires. */
const [premiumHintVisible, setPremiumHintVisible] = createSignal(false);

type SidebarShortcutLinkProps = {
  label: string;
  icon: Component<{ triggerAnimation?: boolean; class?: string }>;
  onClick: () => void;
  isSlim: () => boolean;
  trailing?: JSX.Element;
};

const SidebarShortcutLink = (props: SidebarShortcutLinkProps) => {
  const [isHovering, setIsHovering] = createSignal(false);

  return (
    <div class="group/shortcut relative w-full">
      <NavRow
        draggable={false}
        class={cn(
          'h-7 group-hover/shortcut:bg-ink/3 group-hover/shortcut:text-ink',
          props.trailing && !props.isSlim() && 'pr-8'
        )}
        fullWidth
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
        <div class="relative size-5 shrink-0 flex items-center justify-center [&_svg]:size-3.5">
          <Dynamic component={props.icon} triggerAnimation={isHovering()} />
        </div>

        <div class="flex items-center gap-1 group-data-[slim=true]/sidebar:hidden">
          <span class="flex-1 min-w-0 whitespace-nowrap">{props.label}</span>
        </div>
      </NavRow>

      <Show when={props.trailing && !props.isSlim()}>
        <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
          {props.trailing}
        </div>
      </Show>
    </div>
  );
};

const SidebarSectionMenu = (props: {
  label: string;
  options: { id: SidebarSectionLinkId; label: string; checked: boolean }[];
  onToggle: (id: SidebarSectionLinkId) => void;
  onOpenChange?: (open: boolean) => void;
}) => (
  <Dropdown placement="right-start" gutter={8} onOpenChange={props.onOpenChange}>
    <Dropdown.Trigger
      variant="ghost"
      class="opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 transition-opacity rounded-md size-5 min-h-0 p-0 bg-transparent hover:bg-ink/6 [&_svg]:size-3.5"
      label={`Customize ${props.label}`}
      onMouseDown={(e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e: MouseEvent) => e.stopPropagation()}
    >
      <DotsThreeIcon />
    </Dropdown.Trigger>
    <Dropdown.Content class="w-56 shadow-menu">
      <Dropdown.Group>
        <Dropdown.GroupLabel>Customize</Dropdown.GroupLabel>
        <For each={props.options}>
          {(option) => (
            <Dropdown.CheckboxItem
              checked={option.checked}
              onChange={() => props.onToggle(option.id)}
              closeOnSelect={false}
            >
              <span class="flex-1 truncate">{option.label}</span>
            </Dropdown.CheckboxItem>
          )}
        </For>
      </Dropdown.Group>
    </Dropdown.Content>
  </Dropdown>
);

const SidebarTryItemMenu = (props: {
  label: string;
  onDismiss: () => void;
  onOpenChange?: (open: boolean) => void;
}) => (
  <Dropdown placement="right-start" gutter={8} onOpenChange={props.onOpenChange}>
    <Dropdown.Trigger
      variant="ghost"
      class="shrink-0 opacity-0 group-hover/shortcut:pointer-events-auto group-hover/shortcut:opacity-100 focus-visible:opacity-100 transition-opacity rounded-md size-5 min-h-0 p-0 bg-transparent hover:bg-ink/6 [&_svg]:size-3.5 pointer-events-none"
      label={`${props.label} options`}
      onMouseDown={(e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e: MouseEvent) => e.stopPropagation()}
    >
      <DotsThreeIcon />
    </Dropdown.Trigger>
    <Dropdown.Content class="w-40 shadow-menu">
      <Dropdown.Group>
        <Dropdown.Item
          class="min-h-8 gap-2 px-2.5 text-[13px]"
          onSelect={props.onDismiss}
        >
          <span class="flex-1 truncate text-ink">Dismiss</span>
        </Dropdown.Item>
      </Dropdown.Group>
    </Dropdown.Content>
  </Dropdown>
);

const SidebarDropdownLink = (
  props: SidebarItem & {
    onContextMenuOpenChange?: (open: boolean) => void;
  }
) => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const location = useLocation();
  const [isHovering, setIsHovering] = createSignal(false);
  let contextMenuOpen = false;

  const isActive = () => {
    const activeContent = globalSplitManager()?.activeSplit()?.content();
    if (!activeContent) {
      return location.pathname.split('/').filter(Boolean).includes(props.id);
    }
    return activeContent.id === props.id;
  };

  const handleContextMenuOpenChange = (open: boolean) => {
    contextMenuOpen = open;
    props.onContextMenuOpenChange?.(open);
  };

  onCleanup(() => {
    if (contextMenuOpen) props.onContextMenuOpenChange?.(false);
  });

  const open = (newSplit = false) => {
    analytics.track('sidebar_click', { view: props.id });
    const handle = navigateToSidebarView({
      viewId: props.id,
      params: props.params,
      shiftKey: newSplit,
      activeSplit: globalSplitManager()?.activeSplit(),
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
    if (props.id === 'search' && handle) requestSearchFocus(handle.id);
    globalSplitManager()?.returnFocus();
    return handle;
  };

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? false;
  const openInNewSplit = () => {
    if (canOpenInNewSplit()) open(true);
  };
  const openInCurrentSplit = () => open(false);
  const openFullscreen = () => open(false)?.toggleSpotlight(true);

  const ContextMenuTriggerItem = (
    triggerProps: ComponentProps<typeof ContextMenu.Trigger>
  ) => (
    <ContextMenu onOpenChange={handleContextMenuOpenChange}>
      <ContextMenu.Trigger {...triggerProps} />
      <ContextMenu.Portal>
        <ContextMenuContent class="z-tool-tip! text-xs text-ink-muted">
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

  return (
    <Dropdown.Item
      as={ContextMenuTriggerItem}
      class={cn(
        'min-h-8 gap-2 px-2.5 text-[13px]',
        isActive() &&
          'bg-ink/6 text-ink hover:bg-ink/6 data-highlighted:bg-ink/6'
      )}
      data-active={isActive() ? '' : undefined}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onSelect={openInCurrentSplit}
    >
      <Show when={props.icon}>
        <div class="shrink-0 [&_svg]:size-3.5">
          <Dynamic component={props.icon} triggerAnimation={isHovering()} />
        </div>
      </Show>
      <span class="min-w-0 flex-1 truncate text-ink">{props.label}</span>
      <Hotkey token={props.hotkeyToken} theme="subtle" class="ml-6" />
    </Dropdown.Item>
  );
};

const SidebarHeaderSearchButton = (props: { link: SidebarItem }) => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const openSearch = (event: MouseEvent) => {
    analytics.track('sidebar_click', { view: props.link.id });
    let currentContentHandle = globalSplitManager()?.activeSplit();
    const content = currentContentHandle?.content();

    if (
      currentContentHandle &&
      content?.type === 'component' &&
      content.id === 'search'
    ) {
      requestSearchFocus(currentContentHandle.id);
      globalSplitManager()?.returnFocus();
      return;
    }

    currentContentHandle = navigateToSidebarView({
      viewId: props.link.id,
      params: props.link.params,
      shiftKey: event.shiftKey,
      activeSplit: currentContentHandle,
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
    if (currentContentHandle) requestSearchFocus(currentContentHandle.id);
    globalSplitManager()?.returnFocus();
  };

  return (
    <Button
      size="icon-sm"
      class="[&_svg]:size-4!"
      label="Search"
      hotkey={props.link.hotkeyToken}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
      }}
      onClick={openSearch}
    >
      <MagnifyingGlassIcon />
    </Button>
  );
};

type SidebarSettingsWidgetProps = {
  isSlim: () => boolean;
  onSelect: (tab: SettingsTab) => void;
  onMenuOpenChange?: (open: boolean) => void;
};

const SidebarSettingsWidget = (props: SidebarSettingsWidgetProps) => {
  const userId = useUserId();
  const author = useAuthor();
  const email = useEmail();
  const logout = useLogout();

  return (
    <Dropdown
      placement="top-start"
      gutter={6}
      onOpenChange={props.onMenuOpenChange}
    >
      <Dropdown.Trigger
        variant="ghost"
        class={cn(
          'flex items-center rounded-md cursor-default text-ink-extra-muted not-disabled:hover:bg-ink/3 h-9',
          'justify-start gap-2 px-1.5 py-1'
        )}
        label="Settings"
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
          fallback={<div class="size-5 shrink-0 rounded-full bg-ink/10" />}
        >
          {(id) => (
            <div class="size-5 shrink-0">
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
          Settings
        </span>
        <CaretUpIcon class="size-3 text-ink-extra-muted shrink-0 group-data-[slim=true]/sidebar:hidden" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-64 shadow-menu">
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
                {author()}
              </div>
              <div class="truncate text-sm text-ink-muted">{email()}</div>
            </div>
          </div>
          <div class="-mx-1.5 mt-2 mb-1.5 h-px bg-edge-muted" />
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
            class="flex items-center gap-2 px-2.5 py-2 text-sm cursor-default outline-none text-red-500"
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
 * Assemble the ordered sidebar link list: the static links plus Home and the
 * flag-gated Calls entry in their correct positions. Shared by the rendered
 * sidebar (`AppSidebar.visibleLinks`) and the always-mounted `GoToHotkeys`
 * registrar so their link sets can't drift. Call from a reactive context — it
 * reads `ENABLE_CALLS()`. Rendered sections additionally drop
 * `hiddenFromSidebar`
 * entries, which have hotkeys but no sidebar row.
 */
const buildSidebarLinks = (): SidebarItem[] => {
  let links: SidebarItem[] = [DASHBOARD_LINK, ...SIDEBAR_LINKS];

  if (ENABLE_CALLS()) {
    const idx = links.findIndex((l) => l.id === 'channels');
    links = [...links.slice(0, idx + 1), CALLS_LINK, ...links.slice(idx + 1)];
  }

  return links;
};

export const AppSidebar = (props: AppSidebarProps) => {
  const { openSettings, selectTab, settingsOpen } = useSettingsState();
  const isTabAvailable = useSettingsTabAvailable();
  const currentTeamQuery = useCurrentTeamQuery();
  const [sectionVisibility, setSectionVisibility] = makePersisted(
    createSignal<SidebarSectionVisibility>(DEFAULT_SECTION_VISIBILITY),
    { name: 'sidebar-section-visibility' }
  );
  const [tryVisibility, setTryVisibility] = makePersisted(
    createSignal<TryItemVisibility>(DEFAULT_TRY_VISIBILITY),
    { name: 'sidebar-try-visibility' }
  );

  const hasPaidAccess = useHasPaidAccess();

  /** Persisted dismissal for the Premium upgrade promo card. */
  const [premiumCardDismissed, setPremiumCardDismissed] = makePersisted(
    createSignal<boolean>(false),
    { name: 'sidebar-premium-card-dismissed' }
  );

  const newPricingFF = useFeatureFlag('enable-new-pricing', {
    enabledOverride: ENABLE_NEW_PRICING_OVERRIDE,
  });

  const allLinks = createMemo((): SidebarItem[] => buildSidebarLinks());

  const openSettingsTab = (tab: SettingsTab) => {
    if (!isTabAvailable(tab)) return;
    if (settingsOpen()) {
      selectTab(tab);
      return;
    }
    openSettings(tab);
  };

  const isExpanded = () => props.sidebarState === 'expanded';
  const isCollapsed = () => props.sidebarState === 'slim';
  const overlayOpen = () => props.overlayOpen === true;
  const isOverlayExpanded = () => isCollapsed() && overlayOpen();
  const isExpandedView = () => isExpanded() || isOverlayExpanded();
  const isSlim = () => isCollapsed() && !isOverlayExpanded();
  const sidebarDisplayState = (): SidebarState =>
    isExpandedView() ? 'expanded' : (props.sidebarState ?? 'expanded');
  const currentTeamName = () => currentTeamQuery.data?.team.name?.trim();

  const [hasOverflowTop, setHasOverflowTop] = createSignal(false);
  const [hasOverflowBottom, setHasOverflowBottom] = createSignal(false);
  const [middleScrollRef, setMiddleScrollRef] = createSignal<HTMLDivElement>();
  const middleScrollSize = createElementSize(middleScrollRef);
  const [overlayPointerInside, setOverlayPointerInside] = createSignal(false);
  const [overlayDropdownOpen, setOverlayDropdownOpen] = createSignal(false);
  const [, setWorkspaceContextMenuOpen] = createSignal(false);
  let middleScrollFrame: number | undefined;
  let middleScrollObserver: MutationObserver | undefined;
  let overlayCloseTimer: ReturnType<typeof setTimeout> | undefined;
  let overlayDropdownCloseTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelOverlayClose = () => {
    if (overlayCloseTimer !== undefined) {
      clearTimeout(overlayCloseTimer);
      overlayCloseTimer = undefined;
    }
  };

  const requestOverlayClose = () => {
    if (!isCollapsed()) return;
    cancelOverlayClose();
    overlayCloseTimer = setTimeout(() => {
      overlayCloseTimer = undefined;
      if (!overlayPointerInside() && !overlayDropdownOpen()) {
        props.onOverlayOpenChange?.(false);
      }
    }, SIDEBAR_MAX_WIDTH_TRANSITION_MS);
  };

  const handleOverlayDropdownOpenChange = (open: boolean) => {
    if (!isCollapsed()) return;
    if (overlayDropdownCloseTimer !== undefined) {
      clearTimeout(overlayDropdownCloseTimer);
      overlayDropdownCloseTimer = undefined;
    }

    if (open) {
      setOverlayDropdownOpen(true);
      props.onOverlayOpenChange?.(true);
      cancelOverlayClose();
      return;
    }

    overlayDropdownCloseTimer = setTimeout(() => {
      overlayDropdownCloseTimer = undefined;
      setOverlayDropdownOpen(false);
      if (!overlayPointerInside()) requestOverlayClose();
    }, SIDEBAR_MAX_WIDTH_TRANSITION_MS);
  };

  const handleWorkspaceContextMenuOpenChange = (open: boolean) => {
    setWorkspaceContextMenuOpen(open);
    handleOverlayDropdownOpenChange(open);
  };

  const updateMiddleScrollShadows = () => {
    const el = middleScrollRef();
    if (!el) return;
    const maxScrollTop = el.scrollHeight - el.clientHeight;
    setHasOverflowTop(el.scrollTop > 1);
    setHasOverflowBottom(maxScrollTop - el.scrollTop > 1);
  };

  const scheduleMiddleScrollUpdate = () => {
    if (middleScrollFrame !== undefined)
      cancelAnimationFrame(middleScrollFrame);
    middleScrollFrame = requestAnimationFrame(() => {
      middleScrollFrame = undefined;
      updateMiddleScrollShadows();
    });
  };

  const attachMiddleScrollRef = (el: HTMLDivElement) => {
    middleScrollObserver?.disconnect();
    setMiddleScrollRef(el);
    middleScrollObserver = new MutationObserver(scheduleMiddleScrollUpdate);
    middleScrollObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    scheduleMiddleScrollUpdate();
  };

  onCleanup(() => {
    middleScrollObserver?.disconnect();
    if (middleScrollFrame !== undefined)
      cancelAnimationFrame(middleScrollFrame);
    if (overlayCloseTimer !== undefined) clearTimeout(overlayCloseTimer);
    if (overlayDropdownCloseTimer !== undefined) {
      clearTimeout(overlayDropdownCloseTimer);
    }
  });

  const findLink = (id: SidebarItem['id']) =>
    allLinks().find((link) => link.id === id && !link.hiddenFromSidebar);
  const searchLink = () => allLinks().find((link) => link.id === 'search');

  const renderSidebarLink = (link: SidebarItem) => (
    <Dynamic
      component={link.id === 'mail' ? SidebarMailLink : SidebarLink}
      {...link}
      sidebarState={sidebarDisplayState()}
      hotkeyVisible={goToHotkeyVisible()}
      onContextMenuOpenChange={handleOverlayDropdownOpenChange}
    />
  );

  const toSectionItem = (link: SidebarItem): CollapsibleSidebarSectionItem => ({
    id: String(link.id),
    visible: () => renderSidebarLink(link),
    dropdown: () => (
      <SidebarDropdownLink
        {...link}
        onContextMenuOpenChange={handleWorkspaceContextMenuOpenChange}
      />
    ),
  });

  const topLinks = createMemo(() =>
    ['home', 'inbox']
      .map((id) => findLink(id))
      .filter((link): link is SidebarItem => link !== undefined)
  );

  const sectionItemsFor = (ids: readonly SidebarSectionLinkId[]) =>
    ids
      .filter((id) => sectionVisibility()[id])
      .map((id) => findLink(id))
      .filter((link): link is SidebarItem => link !== undefined)
      .map(toSectionItem);

  const communicationsItems = createMemo(() =>
    sectionItemsFor(COMMUNICATIONS_LINK_IDS)
  );
  const workspaceItems = createMemo(() => sectionItemsFor(WORKSPACE_LINK_IDS));

  const toggleSectionVisibility = (id: SidebarSectionLinkId) => {
    setSectionVisibility({
      ...sectionVisibility(),
      [id]: !sectionVisibility()[id],
    });
    scheduleMiddleScrollUpdate();
  };

  const dismissTryItem = (id: TryItemId) => {
    setTryVisibility({ ...tryVisibility(), [id]: false });
    scheduleMiddleScrollUpdate();
  };

  const sectionMenuOptionsFor = (ids: readonly SidebarSectionLinkId[]) =>
    ids
      .map((id) => findLink(id))
      .filter((link): link is SidebarItem => link !== undefined)
      .map((link) => ({
        id: link.id as SidebarSectionLinkId,
        label: link.label,
        checked: sectionVisibility()[link.id as SidebarSectionLinkId],
      }));

  const tryItems = createMemo<CollapsibleSidebarSectionItem[]>(() => {
    const items: CollapsibleSidebarSectionItem[] = [];
    const addTryItem = (
      id: TryItemId,
      label: string,
      icon: Component<{ triggerAnimation?: boolean; class?: string }>,
      onClick: () => void
    ) => {
      if (!tryVisibility()[id]) return;

      const trailing = (
        <SidebarTryItemMenu
          label={label}
          onDismiss={() => dismissTryItem(id)}
          onOpenChange={handleWorkspaceContextMenuOpenChange}
        />
      );

      items.push({
        id,
        visible: () => (
          <SidebarShortcutLink
            label={label}
            isSlim={isSlim}
            onClick={onClick}
            icon={icon}
            trailing={trailing}
          />
        ),
        dropdown: () => (
          <SidebarShortcutLink
            label={label}
            isSlim={isSlim}
            onClick={onClick}
            icon={icon}
            trailing={trailing}
          />
        ),
      });
    };

    const connected = getSettingsTabItem('Connected');
    if (connected && isTabAvailable('Connected')) {
      addTryItem('connect', 'Connect', connected.icon, () =>
        openSettingsTab('Connected')
      );
    }

    addTryItem('invite', 'Invite', UsersThreeIcon, () =>
      setInviteModalOpen(true)
    );

    const mobile = getSettingsTabItem('Mobile App');
    if (mobile && isTabAvailable('Mobile App')) {
      addTryItem('mobile', 'Mobile', mobile.icon, () =>
        openSettingsTab('Mobile App')
      );
    }
    return items;
  });

  createEffect(() => {
    middleScrollSize.width;
    middleScrollSize.height;
    communicationsItems().length;
    workspaceItems().length;
    tryItems().length;
    props.overlayOpen;
    scheduleMiddleScrollUpdate();
  });

  createEffect(() => {
    if (isCollapsed() && !overlayOpen()) {
      cancelOverlayClose();
      setOverlayPointerInside(false);
      setOverlayDropdownOpen(false);
      setWorkspaceContextMenuOpen(false);
    }
  });

  registerSidebarHotkeys({
    isSlim: isCollapsed,
    onOpenChange: props.onOpenChange,
  });

  return (
    <div
      class={cn(
        'group/sidebar flex flex-col gap-0 overflow-hidden bg-surface px-3 pb-3 pt-4 text-[13px]',
        isExpanded() && 'relative h-full shrink-0 max-w-60 w-60 opacity-100',
        props.sidebarState === 'hidden' &&
          'fixed left-0 top-0 bottom-0 h-full -translate-x-full max-w-0 w-0 opacity-0 pointer-events-none',
        isCollapsed() && 'fixed z-modal-content',
        isCollapsed() &&
          !overlayOpen() &&
          'left-0 inset-y-0 h-full max-w-0 w-0 opacity-0 pointer-events-none -translate-x-2',
        isOverlayExpanded() &&
          'left-0 inset-y-0 h-full max-w-60 w-60 opacity-100 translate-x-0 rounded-r-xl shadow-menu ring-1 ring-edge-muted'
      )}
      data-expanded={isExpandedView()}
      data-slim={isSlim()}
      style={{ transition: SIDEBAR_MAX_WIDTH_TRANSITION_STYLE }}
      onPointerEnter={() => {
        if (!isCollapsed()) return;
        setOverlayPointerInside(true);
        props.onOverlayOpenChange?.(true);
        cancelOverlayClose();
      }}
      onPointerLeave={() => {
        if (!isCollapsed()) return;
        setOverlayPointerInside(false);
        requestOverlayClose();
      }}
    >
      <div class="shrink-0 flex items-center justify-between w-full relative group/logo-area">
        <div class="text-accent min-w-0 flex flex-1 items-center gap-2 pl-2">
          <div class="size-5 shrink-0 flex items-center justify-center">
            <LogoIcon class="size-4" />
          </div>
          <Show when={currentTeamName()}>
            {(teamName) => (
              <span class="min-w-0 truncate text-[13px] font-medium text-ink">
                {teamName()}
              </span>
            )}
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Show when={searchLink()}>
            {(link) => <SidebarHeaderSearchButton link={link()} />}
          </Show>
          <SidebarCreateMenu
            isSlim={isSlim}
            variant="icon"
            onMenuOpenChange={handleOverlayDropdownOpenChange}
          />
        </div>
      </div>

      <nav class="shrink-0 mt-2">
        <ul class="size-full flex flex-col gap-0.5">
          <For each={topLinks()}>
            {(link) => (
              <li class="flex flex-col items-center justify-center">
                {renderSidebarLink(link)}
              </li>
            )}
          </For>
        </ul>
      </nav>

      <div class="relative min-h-0 flex-1 my-3">
        <div
          ref={attachMiddleScrollRef}
          onScroll={updateMiddleScrollShadows}
          class="size-full overflow-y-auto flex flex-col gap-3"
        >
          <Show when={sectionMenuOptionsFor(COMMUNICATIONS_LINK_IDS).length > 0}>
            <CollapsibleSidebarSection
              label="Conversations"
              items={communicationsItems()}
              headerMenu={() => (
                <SidebarSectionMenu
                  label="Conversations"
                  options={sectionMenuOptionsFor(COMMUNICATIONS_LINK_IDS)}
                  onToggle={toggleSectionVisibility}
                  onOpenChange={handleWorkspaceContextMenuOpenChange}
                />
              )}
              onOpenChange={scheduleMiddleScrollUpdate}
            />
          </Show>

          <Show when={sectionMenuOptionsFor(WORKSPACE_LINK_IDS).length > 0}>
            <CollapsibleSidebarSection
              label="Workspace"
              items={workspaceItems()}
              headerMenu={() => (
                <SidebarSectionMenu
                  label="Workspace"
                  options={sectionMenuOptionsFor(WORKSPACE_LINK_IDS)}
                  onToggle={toggleSectionVisibility}
                  onOpenChange={handleWorkspaceContextMenuOpenChange}
                />
              )}
              onOpenChange={scheduleMiddleScrollUpdate}
            />
          </Show>

          <Suspense>
            <FavoritesSection
              sidebarState={sidebarDisplayState()}
              onContextMenuOpenChange={handleOverlayDropdownOpenChange}
            />
          </Suspense>

          <ChannelsUnreadWidget
            sidebarState={sidebarDisplayState()}
            onSectionOpenChange={scheduleMiddleScrollUpdate}
            onDropdownOpenChange={handleOverlayDropdownOpenChange}
          />

          <Show when={tryItems().length > 0}>
            <CollapsibleSidebarSection
              label="Try"
              items={tryItems()}
              onOpenChange={scheduleMiddleScrollUpdate}
            />
          </Show>

          <Show
            when={
              !hasPaidAccess() &&
              isExpandedView() &&
              !premiumCardDismissed() &&
              newPricingFF().enabled
            }
          >
            <div class="w-full px-2">
              <SidebarPromoCard
                label="Upgrade to Premium"
                description="Unlock MCP integrations, better AI models, and team collaboration."
                onDismiss={() => {
                  setPremiumCardDismissed(true);
                  setPremiumHintVisible(true);
                }}
                primaryAction={{
                  label: 'Upgrade',
                  onClick: () => openSettingsTab('Billing'),
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
              isExpandedView() &&
              premiumHintVisible() &&
              premiumCardDismissed() &&
              newPricingFF().enabled
            }
          >
            <div class="w-full px-2">
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
        </div>
        <div
          class={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-3 transition-opacity bg-gradient-to-b from-surface to-transparent',
            hasOverflowTop() ? 'opacity-100' : 'opacity-0'
          )}
        />
        <div
          class={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-3 transition-opacity bg-gradient-to-t from-surface to-transparent',
            hasOverflowBottom() ? 'opacity-100' : 'opacity-0'
          )}
        />
      </div>

      <div class="shrink-0 w-full pt-2">
        <SidebarSettingsWidget
          isSlim={isSlim}
          onSelect={openSettingsTab}
          onMenuOpenChange={handleOverlayDropdownOpenChange}
        />
      </div>
      <InviteModal />
    </div>
  );
};

interface SidebarLinkProps extends SidebarItem {
  sidebarState: SidebarState;
  hotkeyVisible: boolean;
  onContextMenuOpenChange?: (open: boolean) => void;
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
    <ContextMenu onOpenChange={props.onContextMenuOpenChange}>
      <ContextMenu.Trigger class="w-full h-7">
        <NavRow
          draggable={false}
          data-sidebar-link={props.id}
          data-active={isActive() ? '' : undefined}
          active={isActive() && !props.suppressActiveStyle}
          class="h-7"
          fullWidth
          tooltipPlacement="right"
          onMouseEnter={() => setIsHovering(true)}
          label={`Go to ${props.label}`}
          hotkey={
            props.standaloneHotkey
              ? props.hotkeyToken
              : [TOKENS.sidebar.goToLeader, props.hotkeyToken]
          }
          tooltipDisabled={props.sidebarState !== 'slim'}
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
            <div class="size-5 shrink-0 flex items-center justify-center [&_svg]:size-3.5">
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
            <CaretRightIcon
              class={cn(
                'size-3 transition-transform duration-200',
                expanded() && 'rotate-90'
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
          <ul class="min-h-0 overflow-hidden flex flex-col gap-0.5">
            <For each={links()}>
              {(link, index) => (
                <li
                  class={cn(
                    'flex items-center justify-center first:mt-0.5 transition-[opacity,transform] duration-200 ease-out',
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
                  <NavRow
                    draggable={false}
                    disabled={!expanded()}
                    data-sidebar-mail-account={link.email_address}
                    data-active={onlySelectedId() === link.id ? '' : undefined}
                    active={onlySelectedId() === link.id}
                    class="h-7 pl-6 pr-2"
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
                  </NavRow>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </>
  );
};
