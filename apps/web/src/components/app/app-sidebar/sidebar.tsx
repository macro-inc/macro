import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import { LIST_VIEW_PATHS, type ListView } from '@app/constants/list-views';
import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { SidebarActiveCallWidget } from '@app/features/block-call/sidebar/active-call-widget';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { ChannelsRecentWidget } from '@app/features/channel/sidebar/channels-recent-widget';
import { CommandState } from '@app/features/command';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { FavoritesSection } from '@app/features/favorites/sidebar/favorites-section';
import { useGettingStartedEnabled } from '@app/features/getting-started/account-gate';
import { createGettingStartedSidebarVisibility } from '@app/features/getting-started/sidebar-visibility';
import { buildDocumentTypeQuery } from '@app/features/next-soup/filters/configs/document-type-query';
import { getDocumentsFilterSplit } from '@app/features/next-soup/soup-view/documents-filter-controllers';
import {
  getInboxFilterSplit,
  INBOX_FILTER_ENTRY_KEY,
  requestInboxFilter,
} from '@app/features/next-soup/soup-view/inbox-filter-controllers';
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
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { InCallPanel } from '@channel/Call/InCallPanel';
import {
  CollapsibleSidebarSection,
  type CollapsibleSidebarSectionItem,
} from '@components/app/app-sidebar/collapsible-sidebar-section';
import {
  SidebarPromoCard,
  SidebarPromoHint,
} from '@components/app/app-sidebar/sidebar-promo';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type {
  ReferredFrom,
  SplitContent,
  SplitHandle,
} from '@components/app/split-layout/layoutManager';
import { useHasPaidAccess } from '@core/auth';
import { useLogout } from '@core/auth/logout';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { inboxIconProps } from '@core/component/inboxIcon';
import { toast } from '@core/component/Toast/Toast';
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
import { useEmail, useUserId } from '@core/context/user';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { clearPressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import { getDisplayName, tryMacroId } from '@core/user';
import LogoIcon from '@icon/macro-logo.svg';
import { AnimatedActivityIcon } from '@icon/wide-activity';
import WideCalendarIcon from '@icon/wide-calendar.svg';
import { AnimatedCallIcon } from '@icon/wide-call';
import PhoneIcon from '@icon/wide-call.svg';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedCompanyIcon } from '@icon/wide-company';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedHomeIcon } from '@icon/wide-home';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import { ContextMenu } from '@kobalte/core/context-menu';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import CompassIcon from '@phosphor/compass.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import GearIcon from '@phosphor/gear.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import SignOutIcon from '@phosphor/sign-out.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import XIcon from '@phosphor/x.svg';
import { isRealNamePart, useOwnUserName } from '@queries/auth/user-name-self';
import { useActiveCallsQuery } from '@queries/call/call';
import { useEmailLinksQuery } from '@queries/email/link';
import {
  useJoinTeamMutation,
  useRejectInvitationMutation,
  useUserInvitesQuery,
} from '@queries/team/invitations';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import { createElementSize } from '@solid-primitives/resize-observer';
import { debounce } from '@solid-primitives/scheduled';
import { makePersisted } from '@solid-primitives/storage';
import { useLocation } from '@solidjs/router';
import { Button, cn, Dropdown, Hotkey, Layer, NavRow, Tooltip } from '@ui';
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
import { CalendarSidebarPreview } from './calendar-sidebar-preview';

interface SidebarItem {
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

type SidebarSectionLinkId =
  | 'mail'
  | 'channels'
  | 'calls'
  | 'documents'
  | 'tasks'
  | 'calendar'
  | 'agents'
  | 'companies';

type SidebarSectionVisibility = Record<SidebarSectionLinkId, boolean>;

type TryItemId = 'connect' | 'invite' | 'mobile';

type TryItemVisibility = Record<TryItemId, boolean>;

const WORKSPACE_LINK_IDS = [
  'mail',
  'channels',
  'calls',
  'documents',
  'tasks',
  'calendar',
  'agents',
  'companies',
] as const;

const DEFAULT_SECTION_VISIBILITY: SidebarSectionVisibility = {
  mail: true,
  channels: true,
  calls: true,
  documents: true,
  tasks: true,
  calendar: true,
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

function sidebarContent(
  viewId: SidebarItem['id'],
  params?: SidebarItem['params']
): SplitContent {
  return viewId === 'calendar'
    ? { type: 'calendar', id: CALENDAR_BLOCK_ID }
    : { type: 'component', id: viewId, params };
}

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

  return openWithSplit(sidebarContent(viewId, params), {
    preferNewSplit: shiftKey,
    mergeHistory: false,
    allowDuplicate: viewId !== 'calendar',
    referredFrom,
  });
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

  const gettingStartedEnabled = useGettingStartedEnabled();
  const calendarUiEnabled = useCalendarUiFlag();
  const activityFeedEnabled = useActivityFeedFlag();
  const recentViewEnabled = useRecentViewFlag();
  const links = createMemo((): SidebarItem[] =>
    buildSidebarLinks(
      gettingStartedEnabled(),
      calendarUiEnabled(),
      activityFeedEnabled(),
      recentViewEnabled()
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

const SidebarSectionMenu = (props: {
  label: string;
  options: { id: SidebarSectionLinkId; label: string; checked: boolean }[];
  onToggle: (id: SidebarSectionLinkId) => void;
  onOpenChange?: (open: boolean) => void;
}) => (
  <Dropdown
    placement="right-start"
    gutter={8}
    onOpenChange={props.onOpenChange}
  >
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

type TryCardItem = {
  id: TryItemId;
  label: string;
  icon: Component<{ triggerAnimation?: boolean; class?: string }>;
  onClick: () => void;
};

const TryCardRow = (props: { item: TryCardItem }) => {
  const [isHovering, setIsHovering] = createSignal(false);

  return (
    <button
      type="button"
      aria-label={props.item.label}
      class="flex h-7 w-full items-center justify-start gap-2 rounded-md px-1.5 py-0 text-sm font-medium text-ink-muted outline-none hover:bg-ink/5 hover:text-ink focus-visible:bg-ink/5 focus-visible:text-ink [&_svg]:size-3.5"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
      }}
      onClick={props.item.onClick}
    >
      <span class="size-5 shrink-0 flex items-center justify-center">
        <Dynamic component={props.item.icon} triggerAnimation={isHovering()} />
      </span>
      <span class="min-w-0 flex-1 truncate text-left">{props.item.label}</span>
    </button>
  );
};

const TryCard = (props: {
  items: readonly TryCardItem[];
  onDismiss: () => void;
}) => (
  <Layer depth={1}>
    <section aria-label="Quick Start" class="relative group/try-card w-full">
      <div class="rounded-lg border border-ink-muted/8 bg-ink-muted/2.5 overflow-hidden">
        <header class="flex items-center gap-2 min-w-0 px-2.5 py-1.5 border-b border-ink-muted/8">
          <h3 class="flex-1 min-w-0 text-xs font-medium text-ink leading-tight m-0">
            Quick Start
          </h3>
          <Button
            variant="ghost"
            class="shrink-0 size-5 rounded-sm p-0 [&_svg]:size-3"
            label="Dismiss Quick Start"
            onClick={(e) => {
              e.stopPropagation();
              props.onDismiss();
            }}
          >
            <XIcon />
          </Button>
        </header>
        <div class="p-1 flex flex-col gap-0.5">
          <For each={props.items}>{(item) => <TryCardRow item={item} />}</For>
        </div>
      </div>
    </section>
  </Layer>
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
    const expectedContent = sidebarContent(props.id, props.params);
    return (
      activeContent.type === expectedContent.type &&
      activeContent.id === expectedContent.id
    );
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
  const canOpenFullscreen = () => layout.getSplitCount() > 1;
  const openInNewSplit = () => {
    if (canOpenInNewSplit()) open(true);
  };
  const openInCurrentSplit = () => open(false);
  const openFullscreen = () => {
    analytics.track('sidebar_click', { view: props.id });
    const handle = layout.replaceAllSplits(
      sidebarContent(props.id, props.params),
      { referredFrom: 'sidebar' }
    );
    if (props.id === 'search' && handle) requestSearchFocus(handle.id);
    globalSplitManager()?.returnFocus();
  };

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
          <Show when={canOpenFullscreen()}>
            <MenuItem text="Open fullscreen" onClick={openFullscreen} />
          </Show>
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
  /**
   * The Getting Started link, surfaced here only while it's hidden from the
   * sidebar rows (see `AppSidebar`). Keeps the page reachable from the account
   * menu once the user removes its dedicated row.
   */
  gettingStartedLink?: SidebarItem;
};

const SidebarSettingsWidget = (props: SidebarSettingsWidgetProps) => {
  const userId = useUserId();
  const email = useEmail();
  const logout = useLogout();
  const layout = useSplitLayout();

  const userName = useOwnUserName();

  const openGettingStarted = () => {
    const link = props.gettingStartedLink;
    if (!link) return;
    navigateToSidebarView({
      viewId: link.id,
      params: link.params,
      shiftKey: false,
      activeSplit: globalSplitManager()?.activeSplit(),
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
  };

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
          'flex items-center rounded-md cursor-default text-ink-extra-muted not-disabled:hover:bg-ink/3 h-9',
          'justify-start gap-3 px-1.5 py-1'
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
          {displayName()}
        </span>
        <CaretUpIcon class="size-3 text-ink-extra-muted shrink-0 group-data-[slim=true]/sidebar:hidden" />
      </Dropdown.Trigger>
      {/*
        The menu is shrink-to-fit, so without a cap a long name or email
        stretches it instead of engaging the `truncate` below.
      */}
      <Dropdown.Content class="min-w-[min(16rem,calc(100vw-1rem))] max-w-[min(20rem,calc(100vw-1rem))] shadow-menu">
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
          <div class="-mx-1.5 mt-2 mb-1.5 h-px bg-edge-muted" />
          <Show when={props.gettingStartedLink}>
            {(link) => (
              <Dropdown.Item
                class="flex items-center gap-2 px-2.5 py-2 text-sm cursor-default outline-none text-ink-muted"
                onSelect={openGettingStarted}
              >
                <span class="size-5 flex items-center justify-center">
                  <Dynamic
                    component={link().icon}
                    class="size-4 shrink-0 text-ink-extra-muted"
                  />
                </span>
                <span class="flex-1 text-ink">{link().label}</span>
                <Hotkey
                  // Hardcoding this so that we can include the command scope activation
                  shortcut="g s"
                  theme="subtle"
                  class="ml-6"
                />
              </Dropdown.Item>
            )}
          </Show>
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
 * Shared by the rendered sidebar (`AppSidebar.visibleLinks`) and the
 * always-mounted `GoToHotkeys` registrar so their link sets can't drift. Call
 * from a reactive context — it reads `ENABLE_CALLS()` / `ENABLE_CRM()`.
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

const TeamInviteSidebarPromo = (props: { invite: TeamInviteDetails }) => {
  const inviterName = () => getDisplayName(tryMacroId(props.invite.invited_by));
  const joinTeamMutation = useJoinTeamMutation();
  const rejectInvitationMutation = useRejectInvitationMutation();
  const mutationPending = () =>
    joinTeamMutation.isPending || rejectInvitationMutation.isPending;

  return (
    <SidebarPromoCard
      label="Team invitation"
      description={`${inviterName() || 'A teammate'} invited you to join a team as ${props.invite.team_role}.`}
      primaryAction={{
        label: 'Accept',
        disabled: mutationPending(),
        onClick: () =>
          joinTeamMutation.mutate({ teamInviteId: props.invite.id }),
      }}
      secondaryAction={{
        label: 'Decline',
        disabled: mutationPending(),
        onClick: () =>
          rejectInvitationMutation.mutate({ teamInviteId: props.invite.id }),
      }}
    />
  );
};

export const AppSidebar = (props: AppSidebarProps) => {
  const { openSettings, selectTab, settingsOpen } = useSettingsState();
  const isTabAvailable = useSettingsTabAvailable();
  const currentTeamQuery = useCurrentTeamQuery();
  const userInvitesQuery = useUserInvitesQuery();
  const firstTeamInvite = () => userInvitesQuery.data?.invites.at(0);
  const [sectionVisibility, setSectionVisibility] = makePersisted(
    createSignal<Partial<SidebarSectionVisibility>>(DEFAULT_SECTION_VISIBILITY),
    { name: 'sidebar-section-visibility' }
  );
  const [tryVisibility, setTryVisibility] = makePersisted(
    createSignal<TryItemVisibility>(DEFAULT_TRY_VISIBILITY),
    { name: 'sidebar-try-visibility' }
  );
  const callCtx = useCallContextOptional();

  const hasPaidAccess = useHasPaidAccess();

  /** Persisted dismissal for the Premium upgrade promo card. */
  const [premiumCardDismissed, setPremiumCardDismissed] = makePersisted(
    createSignal<boolean>(false),
    { name: 'sidebar-premium-card-dismissed' }
  );

  const newPricingFF = useFeatureFlag('enable-new-pricing', {
    enabledOverride: ENABLE_NEW_PRICING_OVERRIDE,
  });

  const gettingStartedEnabled = useGettingStartedEnabled();
  const calendarUiEnabled = useCalendarUiFlag();
  const activityFeedEnabled = useActivityFeedFlag();
  const recentViewEnabled = useRecentViewFlag();
  const allLinks = createMemo((): SidebarItem[] =>
    buildSidebarLinks(
      gettingStartedEnabled(),
      calendarUiEnabled(),
      activityFeedEnabled(),
      recentViewEnabled()
    )
  );

  // Hides only the rendered row: the g+s hotkey and command menu entry keep
  // working (like `hiddenFromSidebar` links), so the page stays reachable.
  const gettingStartedVisibility = createGettingStartedSidebarVisibility();

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
  const channelsLink = () => allLinks().find((link) => link.id === 'channels');
  const channelsContent = () =>
    ({
      type: 'component',
      id: 'channels',
      params: channelsLink()?.params,
    }) as const;

  const renderSidebarLink = (link: SidebarItem) => (
    <Dynamic
      component={link.id === 'mail' ? SidebarMailLink : SidebarLink}
      {...link}
      sidebarState={sidebarDisplayState()}
      hotkeyVisible={goToHotkeyVisible()}
      onContextMenuOpenChange={handleOverlayDropdownOpenChange}
      trailing={link.id === 'channels' ? <ChannelsActiveCallIcon /> : undefined}
      removeAction={
        link.id === 'getting-started'
          ? {
              tooltip: 'Remove from sidebar',
              onRemove: () => {
                gettingStartedVisibility.hide();
                // Hiding drops the row only — the go-to hotkey and its
                // command-menu entry stay registered (see buildSidebarLinks),
                // so this stays true.
                toast.success('Removed from sidebar', {
                  subtext:
                    'You can always find Getting Started in the account menu or command menu.',
                });
              },
            }
          : undefined
      }
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

  // Ids, not the built list: this group is a fixed set, and everything else
  // lives in the collapsible Workspace section. `findLink` drops ids that
  // `buildSidebarLinks` gated out, so flag-gated rows need no filter here.
  const topLinks = createMemo(() =>
    ['home', 'getting-started', 'inbox', 'recent', 'activity']
      .filter(
        (id) => id !== 'getting-started' || !gettingStartedVisibility.hidden()
      )
      .map((id) => findLink(id))
      .filter((link): link is SidebarItem => link !== undefined)
  );

  const isSectionVisible = (id: SidebarSectionLinkId) =>
    sectionVisibility()[id] ?? DEFAULT_SECTION_VISIBILITY[id];

  // While the Getting Started row is hidden (but still account-gated in via
  // `findLink`), surface it in the account menu so the page stays reachable.
  const gettingStartedMenuLink = createMemo(() =>
    gettingStartedVisibility.hidden() ? findLink('getting-started') : undefined
  );

  const sectionItemsFor = (ids: readonly SidebarSectionLinkId[]) =>
    ids
      .filter(isSectionVisible)
      .map((id) => findLink(id))
      .filter((link): link is SidebarItem => link !== undefined)
      .map(toSectionItem);

  const workspaceItems = createMemo(() => sectionItemsFor(WORKSPACE_LINK_IDS));

  const toggleSectionVisibility = (id: SidebarSectionLinkId) => {
    setSectionVisibility({
      ...sectionVisibility(),
      [id]: !isSectionVisible(id),
    });
    scheduleMiddleScrollUpdate();
  };

  const dismissTryItem = (id: TryItemId) => {
    setTryVisibility({ ...tryVisibility(), [id]: false });
    scheduleMiddleScrollUpdate();
  };

  const dismissTrySection = () => {
    setTryVisibility({
      connect: false,
      invite: false,
      mobile: false,
    });
  };

  const sectionMenuOptionsFor = (ids: readonly SidebarSectionLinkId[]) =>
    ids
      .map((id) => findLink(id))
      .filter((link): link is SidebarItem => link !== undefined)
      .map((link) => ({
        id: link.id as SidebarSectionLinkId,
        label: link.label,
        checked: isSectionVisible(link.id as SidebarSectionLinkId),
      }));

  const tryItems = createMemo<TryCardItem[]>(() => {
    const items: TryCardItem[] = [];
    const addTryItem = (
      id: TryItemId,
      label: string,
      icon: Component<{ triggerAnimation?: boolean; class?: string }>,
      onClick: () => void
    ) => {
      if (!tryVisibility()[id]) return;

      items.push({
        id,
        label,
        icon,
        onClick: () => {
          onClick();
          dismissTryItem(id);
        },
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

  // hotkeyScopeNeutralAttribute: focusing anything in the sidebar (rows, the
  // workspace toggle, ...) must not flip the active hotkey scope to 'global',
  // which would mute the active split's hotkeys until the user clicks back
  // into a split. The sidebar's own hotkeys register on the 'global' scope,
  // which every scope chain reaches, so they don't need the flip either.
  return (
    <div
      {...hotkeyScopeNeutralAttribute}
      class={cn(
        'group/sidebar flex flex-col gap-0 overflow-hidden bg-surface px-3 pb-3 pt-4 text-[13px]',
        isExpanded() && 'relative h-full shrink-0 max-w-55 w-55 opacity-100',
        props.sidebarState === 'hidden' &&
          'fixed left-0 top-0 bottom-0 h-full -translate-x-full max-w-0 w-0 opacity-0 pointer-events-none',
        isCollapsed() && 'fixed z-modal-content',
        isCollapsed() &&
          !overlayOpen() &&
          'left-0 inset-y-0 h-full max-w-0 w-0 opacity-0 pointer-events-none -translate-x-2',
        isOverlayExpanded() &&
          'left-0 inset-y-0 h-full max-w-55 w-55 opacity-100 translate-x-0 rounded-r-xl shadow-menu ring-1 ring-edge-muted'
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
          <CollapsibleSidebarSection
            label="Workspace"
            persistKey="workspace"
            items={workspaceItems()}
            headerMenu={() => (
              <div class="pointer-events-auto">
                <SidebarSectionMenu
                  label="Workspace"
                  options={sectionMenuOptionsFor(WORKSPACE_LINK_IDS)}
                  onToggle={toggleSectionVisibility}
                  onOpenChange={handleWorkspaceContextMenuOpenChange}
                />
              </div>
            )}
            onOpenChange={scheduleMiddleScrollUpdate}
          />

          <Suspense>
            <FavoritesSection
              sidebarState={sidebarDisplayState()}
              onContextMenuOpenChange={handleOverlayDropdownOpenChange}
            />
          </Suspense>

          <Suspense>
            <ChannelsRecentWidget
              sidebarState={sidebarDisplayState()}
              onSectionOpenChange={scheduleMiddleScrollUpdate}
              onDropdownOpenChange={handleOverlayDropdownOpenChange}
              headerWrapper={(header) => (
                <SidebarOpenInSplitMenu
                  content={channelsContent}
                  onOpenChange={handleOverlayDropdownOpenChange}
                >
                  {header}
                </SidebarOpenInSplitMenu>
              )}
            />
          </Suspense>
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

      <div class="shrink-0 w-full pt-2 flex flex-col gap-2">
        <Show when={isExpandedView()}>
          <SidebarActiveCallWidget
            sidebarState="expanded"
            class="rounded-xl border border-edge-muted bg-surface shadow-menu p-1"
          />
        </Show>
        <Show when={isExpandedView() && callCtx?.isInCall()}>
          <div data-ui="sidebar-in-call-panel">
            <InCallPanel isSlim={() => false} />
          </div>
        </Show>
        <Show keyed when={isExpandedView() ? firstTeamInvite() : undefined}>
          {(invite) => <TeamInviteSidebarPromo invite={invite} />}
        </Show>
        <Show
          when={
            !hasPaidAccess() &&
            isExpandedView() &&
            !userInvitesQuery.isLoading &&
            !firstTeamInvite() &&
            !premiumCardDismissed() &&
            newPricingFF().enabled
          }
        >
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
        </Show>
        <Show
          when={
            !hasPaidAccess() &&
            isExpandedView() &&
            !userInvitesQuery.isLoading &&
            !firstTeamInvite() &&
            premiumHintVisible() &&
            premiumCardDismissed() &&
            newPricingFF().enabled
          }
        >
          <SidebarPromoHint
            title="Maybe later"
            message="You can upgrade anytime from Account settings."
            onDone={() => setPremiumHintVisible(false)}
            secondaryAction={{
              label: 'Take me there',
              onClick: () => openSettingsTab('Account'),
            }}
          />
        </Show>
        <Show when={isExpandedView() && tryItems().length > 0}>
          <TryCard items={tryItems()} onDismiss={dismissTrySection} />
        </Show>
        <SidebarSettingsWidget
          isSlim={isSlim}
          onSelect={openSettingsTab}
          onMenuOpenChange={handleOverlayDropdownOpenChange}
          gettingStartedLink={gettingStartedMenuLink()}
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
  /**
   * Always-visible indicator at the link's right edge (unlike
   * `trailingWhenActive`). In slim mode it overlays the icon's top-right
   * corner instead, since the label region is hidden.
   */
  trailing?: JSX.Element;
  /**
   * Swaps the icon for an X while the row is hovered (expanded sidebar only —
   * in slim mode the icon is the whole row, so the swap would hijack
   * navigation). Clicking the X calls `onRemove` instead of navigating.
   */
  removeAction?: { tooltip: string; onRemove: () => void };
}

/** Which action of {@link SidebarOpenInSplitMenu} placed the content. */
type SidebarOpenAction = 'current-split' | 'new-split' | 'fullscreen';

interface SidebarOpenInSplitMenuProps {
  /** The content the menu's actions open. */
  content: () => SplitContent;
  /**
   * Runs once an action has placed the content in a split — e.g. the Email
   * account rows scope the freshly opened mail list to their inbox.
   */
  onOpened?: (split: SplitHandle, action: SidebarOpenAction) => void;
  onOpenChange?: (open: boolean) => void;
  children: JSX.Element;
}

/**
 * The shared sidebar right-click menu: open the row's content in the current
 * split, in a new split, or fullscreen. Wraps any sidebar row — the top-level
 * links and the nested Email account rows both use it.
 */
const SidebarOpenInSplitMenu = (props: SidebarOpenInSplitMenuProps) => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? true;
  const canOpenFullscreen = () => layout.getSplitCount() > 1;

  const openInCurrentSplit = () => {
    const split = layout.openWithSplit(props.content(), {
      allowDuplicate: true,
      mergeHistory: false,
      referredFrom: 'sidebar',
    });
    if (split) props.onOpened?.(split, 'current-split');
  };

  const openInNewSplit = () => {
    const manager = globalSplitManager();
    if (!manager || !manager.canAppendSplit()) return;

    analytics.track('split_created', { from: 'sidebar' });

    const split = manager.createNewSplit({
      content: props.content(),
      activate: true,
      allowDuplicate: true,
      referredFrom: 'sidebar',
    });
    props.onOpened?.(split, 'new-split');
  };

  const openFullscreen = () => {
    const split = layout.replaceAllSplits(props.content(), {
      referredFrom: 'sidebar',
    });
    if (split) props.onOpened?.(split, 'fullscreen');
    globalSplitManager()?.returnFocus();
  };

  return (
    <ContextMenu onOpenChange={props.onOpenChange}>
      <ContextMenu.Trigger class="w-full h-7">
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
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
};

/**
 * Accent phone icon on the Channels link while any channel the user is a
 * member of has a live call. Backed by the shared all-active-calls query,
 * which the call websocket events keep current.
 */
const ChannelsActiveCallIcon = () => {
  const activeCallsQuery = useActiveCallsQuery();

  return (
    <Show when={(activeCallsQuery.data ?? []).length > 0}>
      <PhoneIcon class="size-4 shrink-0 text-accent fill-accent" />
    </Show>
  );
};

const SidebarLinkRow = (props: SidebarLinkProps) => {
  const [isHovering, setIsHovering] = createSignal(false);

  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const location = useLocation();
  const content = () => sidebarContent(props.id, props.params);

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

    const expectedContent = content();
    return (
      activeContent.type === expectedContent.type &&
      activeContent.id === expectedContent.id
    );
  };

  return (
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
      tooltipDisabled={props.sidebarState !== 'slim' || props.id === 'calendar'}
      onMouseLeave={() => setIsHovering(false)}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        analytics.track('sidebar_click', {
          view: props.id,
        });

        e.preventDefault();
        let currentContentHandle = globalSplitManager()?.activeSplit();

        const currentContent = currentContentHandle?.content();
        const expectedContent = content();
        const isSameContent =
          currentContent?.type === expectedContent.type &&
          currentContent.id === expectedContent.id;

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
          <Show
            when={
              isHovering() && props.sidebarState !== 'slim'
                ? props.removeAction
                : undefined
            }
            fallback={
              <Dynamic component={props.icon} triggerAnimation={isHovering()} />
            }
          >
            {(removeAction) => (
              <Tooltip label={removeAction().tooltip} as="span" placement="top">
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={removeAction().tooltip}
                  class="flex items-center justify-center text-ink-muted
                   rounded-md hover:bg-failure hover:text-surface p-1"
                  onMouseDown={(e) => {
                    // The row navigates on mousedown; the X must not.
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAction().onRemove();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      removeAction().onRemove();
                    }
                  }}
                >
                  <XIcon />
                </span>
              </Tooltip>
            )}
          </Show>
        </div>
      </Show>

      <div class="flex items-center gap-1 group-data-[slim=true]/sidebar:hidden">
        <span class="whitespace-nowrap">{props.label}</span>
      </div>

      <Show when={props.trailing}>
        <div
          class={cn(
            'flex items-center',
            props.sidebarState === 'slim'
              ? 'absolute -top-1 -right-1'
              : 'ml-auto'
          )}
        >
          {props.trailing}
        </div>
      </Show>

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
  );
};

const SidebarLink = (props: SidebarLinkProps) => {
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const content = () => sidebarContent(props.id, props.params);
  const handleContextMenuOpenChange = (open: boolean) => {
    setContextMenuOpen(open);
    // Keep the collapsed sidebar overlay mounted while its portaled menu is open.
    props.onContextMenuOpenChange?.(open);
  };

  return (
    <SidebarOpenInSplitMenu
      content={content}
      onOpenChange={handleContextMenuOpenChange}
      onOpened={(split, action) => {
        if (action === 'fullscreen' && props.id === 'search')
          requestSearchFocus(split.id);
      }}
    >
      <Show
        when={props.id === 'calendar'}
        fallback={<SidebarLinkRow {...props} />}
      >
        <CalendarSidebarPreview disabled={contextMenuOpen()}>
          <SidebarLinkRow {...props} />
        </CalendarSidebarPreview>
      </Show>
    </SidebarOpenInSplitMenu>
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
 *
 * Each row carries the same right-click menu as the parent link (open in the
 * current split, a new split, or fullscreen), scoping whichever split it opens
 * to that inbox.
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

  /** The mail list content an account row's right-click menu opens. */
  const mailContent = () =>
    ({
      type: 'component',
      id: props.id,
      params: props.params,
    }) as const;

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
                  <SidebarOpenInSplitMenu
                    content={mailContent}
                    // Keeps the hover overlay open over a slim sidebar while
                    // the menu is up, same as the parent link's menu.
                    onOpenChange={props.onContextMenuOpenChange}
                    onOpened={(split) =>
                      requestInboxFilter(split.id, [link.id])
                    }
                  >
                    <NavRow
                      draggable={false}
                      disabled={!expanded()}
                      data-sidebar-mail-account={link.email_address}
                      data-active={
                        onlySelectedId() === link.id ? '' : undefined
                      }
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
                  </SidebarOpenInSplitMenu>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </>
  );
};
