import { AnimatedUsersIcon } from '@macro-icons/wide/animating/users';
import { AnimatedGearIcon } from '@macro-icons/wide/animating/gear';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';
import { AnimatedInboxIcon } from '@macro-icons/wide/animating/inbox';
import { AnimatedSearchIcon } from '@macro-icons/wide/animating/search';
import { AnimatedSidebarIcon } from '@macro-icons/wide/animating/sidebar';
import { AnimatedPlusIcon } from '@macro-icons/wide/animating/plus';
import { AnimatedNewSplitIcon } from '@macro-icons/wide/animating/newSplit';
import { AnimatedCommandIcon } from '@macro-icons/wide/animating/command';
import { useLocation } from '@solidjs/router';
import LogoIcon from '@macro-icons/macro-logo.svg';
import {
  LIST_VIEW_ID,
  LIST_VIEW_PATHS,
  type ListView,
} from '@app/constants/list-views';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { createMenuOpen, setCreateMenuOpen } from '@app/component/Launcher';
import { CommandState } from '@app/component/command';
import { cn } from '@ui/utils/classname';
import { Button } from '@ui/components/Button';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { ChannelsUnreadWidget } from '@app/component/app-sidebar/channels-unread-widget';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSettingsState } from '@core/constant/SettingsState';
import type { ValidHotkey } from '@core/hotkey/types';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import { debounce } from '@solid-primitives/scheduled';
import { Hotkey } from '@core/component/Hotkey';
import { clearPressedKeys } from '@core/hotkey/state';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import { ContextMenuContent, MenuItem } from '@core/component/Menu';
import { ContextMenu } from '@kobalte/core/context-menu';
import { useAnalytics } from '@app/component/analytics-context';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import {
  InviteModal,
  setInviteModalOpen,
} from '@app/component/app-sidebar/invite-modal';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';

interface SidebarItem {
  id: ListView;
  label: string;
  href: string;
  icon?: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
  >;
  hotkey: ValidHotkey;
  standaloneHotkey?: boolean;
}

export const SIDEBAR_LINKS = [
  {
    id: 'inbox',
    label: 'Inbox',
    href: LIST_VIEW_PATHS.inbox,
    icon: AnimatedInboxIcon,
    hotkey: 'i',
  },
  {
    id: 'search',
    label: 'Search',
    href: LIST_VIEW_PATHS.search,
    icon: AnimatedSearchIcon,
    hotkey: '/',
    standaloneHotkey: true,
  },
  {
    id: 'agents',
    label: 'Agents',
    href: LIST_VIEW_PATHS.agents,
    icon: AnimatedStarIcon,
    hotkey: 'a',
  },
  {
    id: 'mail',
    label: 'Email',
    href: LIST_VIEW_PATHS.mail,
    icon: AnimatedEmailIcon,
    hotkey: 'e',
  },
  {
    id: 'documents',
    label: 'Documents',
    href: LIST_VIEW_PATHS.documents,
    icon: AnimatedFileMdIcon,
    hotkey: 'd',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    href: LIST_VIEW_PATHS.tasks,
    icon: AnimatedTaskIcon,
    hotkey: 't',
  },
  {
    id: 'channels',
    label: 'Channels',
    href: LIST_VIEW_PATHS.channels,
    icon: AnimatedChannelIcon,
    hotkey: 'c',
  },
  {
    id: 'folders',
    label: 'Folders',
    href: LIST_VIEW_PATHS.folders,
    icon: AnimatedFolderIcon,
    hotkey: 'f',
  },
] satisfies SidebarItem[];

export type SidebarState = 'hidden' | 'expanded' | 'slim';

type AppSidebarProps = {
  sidebarState?: SidebarState;
  onOpenChange: (open: boolean) => void;
};

type SidebarHotkeyDeps = {
  hotkeyVisible: () => boolean;
  setHotkeyVisible: (visible: boolean) => void;
  resetHotkeysState: VoidFunction;
  isSlim: () => boolean;
  onOpenChange: (open: boolean) => void;
  openWithSplit: ReturnType<typeof useSplitLayout>['openWithSplit'];
};

export const registerSidebarHotkeys = ({
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
    ...SIDEBAR_LINKS.map((link) => link.hotkey),
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
    description: 'Invite team',
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
  for (const link of SIDEBAR_LINKS) {
    const openSidebarView = (e?: KeyboardEvent) => {
      e?.preventDefault();
      if (hotkeyVisible()) {
        resetHotkeysState();
        debounceResetHotkeysState.clear();
      }
      openWithSplit(
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
      return true;
    };

    registerHotkey({
      hotkey: link.hotkey,
      scopeId: link.standaloneHotkey ? 'global' : GO_TO_COMMAND_SCOPE,
      description: `Go to ${link.label}`,
      keyDownHandler: openSidebarView,
      icon: link.icon,
    });
  }
};

// ---------------------------------------------------------------------------
// SidebarActionButton
// ---------------------------------------------------------------------------

type SidebarActionButtonProps = {
  label: string;
  hotkeyToken?: HotkeyToken;
  /** Whether the sidebar is currently in slim (icon-only) mode. */
  isSlim: () => boolean;
  onClick: () => void;
  disabled?: boolean | (() => boolean);
  /** Animated icon component that accepts a `triggerAnimation` prop. */
  icon: Component<{ triggerAnimation?: boolean; class?: string }>;
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
      class="flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs py-1"
      variant="ghost"
      tooltipPlacement="right"
      tooltip={
        props.isSlim() ? (
          <LabelAndHotKey label={props.label} hotkeyToken={props.hotkeyToken} />
        ) : undefined
      }
      onClick={props.onClick}
      disabled={isDisabled()}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        class={`size-4 shrink-0 transition-colors duration-300 ${hovering() ? 'text-accent' : ''}`}
      >
        <Dynamic component={props.icon} triggerAnimation={hovering()} />
      </div>
      <span class="whitespace-nowrap group-data-[slim=true]/sidebar:invisible">
        {props.label}
      </span>
      <Show when={props.hotkeyToken}>
        {(token) => (
          <div class="text-[0.625rem] text-ink-extra-muted/50 rounded-sm ml-auto border border-ink/5 px-1.5 py-0.25 -my-1 group-data-[slim=true]/sidebar:invisible">
            <Hotkey token={token()} class="flex gap-1" />
          </div>
        )}
      </Show>
    </Button>
  );
};

export const AppSidebar = (props: AppSidebarProps) => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const { toggleSettings } = useSettingsState();

  const [hotkeyVisible, setHotkeyVisible] = createSignal(false);

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

  const isExpanded = () => props.sidebarState === 'expanded';
  const isSlim = () => props.sidebarState === 'slim';
  const [sidebarBtnHovering, setSidebarBtnHovering] = createSignal(false);

  registerSidebarHotkeys({
    hotkeyVisible,
    setHotkeyVisible,
    resetHotkeysState,
    isSlim,
    onOpenChange: props.onOpenChange,
    openWithSplit: layout.openWithSplit,
  });

  return (
    <div
      class={cn(
        'group/sidebar h-full py-2 flex flex-col gap-0 mobile:absolute mobile:z-modal-content overflow-hidden',
        isExpanded() &&
          'max-w-56 w-full mobile:max-w-2/3 translate-x-0 opacity-100',
        props.sidebarState === 'hidden' &&
          '-translate-x-full overflow-hidden opacity-0',

        isSlim() && 'max-w-12 w-full mobile:max-w-2/3 translate-x-0 opacity-100'
      )}
      data-expanded={isExpanded()}
      data-slim={isSlim()}
      style={{ transition: 'max-width ease-in-out 100ms' }}
    >
      <div class="flex items-center justify-between py-2 pl-2 pr-2 relative">
        <div class="flex items-center group/logo-area w-full">
          <div class="text-accent group-data-[slim=true]/sidebar:opacity-0 group-data-[slim=true]/sidebar:max-w-0 min-w-0 pl-1 group-data-[slim=true]/sidebar:pl-0 ">
            <LogoIcon class="size-6" />
          </div>
          <div class="grow-1 shrink-10 min-w-0" />
          <Button
            class="flex items-center justify-center rounded-xs p-0.5 px-2 bg-page [&_svg]:size-4"
            onClick={() => props.onOpenChange(!isExpanded())}
            onMouseEnter={() => setSidebarBtnHovering(true)}
            onMouseLeave={() => setSidebarBtnHovering(false)}
            tooltip={
              <LabelAndHotKey
                label={isExpanded() ? 'Shrink Sidebar' : 'Expand Sidebar'}
                hotkeyToken={TOKENS.global.toggleSidebar}
              />
            }
          >
            <AnimatedSidebarIcon triggerAnimation={sidebarBtnHovering()} />
          </Button>
        </div>
      </div>

      <div class="px-2">
        <hr class="border-ink/5" />
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
        <hr class="border-ink/5 mb-[8px]" />
      </div>

      <nav>
        <ul class="w-full h-full px-2 flex flex-col gap-1">
          <For each={SIDEBAR_LINKS}>
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
        <hr class="border-ink/5 my-[8px]" />
      </div>

      <Show when={isExpanded()}>
        <div class="block max-h-[clamp(10%,60%,20rem)]">
          <ChannelsUnreadWidget />
        </div>
      </Show>

      <div class="px-2 mt-auto w-full">
        <hr class="border-edge-muted mb-[8px]" />
      </div>

      <div class=" w-full px-2 flex flex-col">
        <Show when={DEV_MODE_ENV}>
          <SidebarActionButton
            label="Invite Team"
            isSlim={isSlim}
            onClick={() => setInviteModalOpen(true)}
            icon={AnimatedUsersIcon}
          />
        </Show>

        <SidebarActionButton
          label="New Split"
          hotkeyToken={TOKENS.global.createNewSplit}
          isSlim={isSlim}
          onClick={handleNewSplitClick}
          disabled={() => !canCreateNewSplit()}
          icon={AnimatedNewSplitIcon}
        />

        <SidebarActionButton
          label="Command"
          hotkeyToken={TOKENS.global.commandMenu}
          isSlim={isSlim}
          onClick={handleCommandPaletteClick}
          icon={AnimatedCommandIcon}
        />

        <SidebarActionButton
          label="Settings"
          hotkeyToken={TOKENS.global.toggleSettings}
          isSlim={isSlim}
          onClick={toggleSettings}
          icon={AnimatedGearIcon}
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
          as="button"
          draggable={false}
          variant="ghost"
          class={cn(
            'flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs py-1 text-ink-extra-muted',
            isActive() && 'bg-ink/5 not-disabled:hover:bg-ink/10 text-ink'
          )}
          tooltipPlacement="right"
          onMouseEnter={() => setIsHovering(true)}
          tooltip={
            props.sidebarState === 'slim' ? (
              <LabelAndHotKey
                label={`Go to ${props.label}`}
                hotkeySequence={
                  props.standaloneHotkey
                    ? [{ shortcut: props.hotkey }]
                    : [
                        { shortcut: GO_TO_LEADER_KEY },
                        { shortcut: props.hotkey },
                      ]
                }
              />
            ) : undefined
          }
          onMouseLeave={() => setIsHovering(false)}
          onClick={(e) => {
            analytics.track('sidebar_click', {
              view: props.id,
            });
            // Middle mouse handling
            if (e.button === 1) return;

            e.preventDefault();
            layout.openWithSplit(content(), {
              preferNewSplit: e.shiftKey,
              mergeHistory: false,
              allowDuplicate: true,
              referredFrom: 'sidebar',
            });
          }}
        >
          <Show when={props.icon}>
            <div class="shrink-0 [&_svg]:size-4">
              <Dynamic component={props.icon} triggerAnimation={isHovering()} />
            </div>
          </Show>
          <span class="whitespace-nowrap group-data-[slim=true]/sidebar:invisible">
            {props.label}
          </span>

          <Show when={isHovering() && !props.hotkeyVisible}>
            <div class="group-data-[slim=true]/sidebar:invisible ml-auto">
              <div class="flex gap-1 items-center text-ink-extra-muted font-normal text-[0.625rem]">
                <Show when={!props.standaloneHotkey}>
                  <div class="text-[0.625rem] text-ink-extra-muted rounded-sm ml-auto border border-ink/5 px-1.5 py-0.5 -my-1">
                    <Hotkey shortcut={GO_TO_LEADER_KEY} />
                  </div>
                  then
                  <div class="text-[0.625rem] text-ink-extra-muted rounded-sm ml-auto border border-ink/5 px-1.5 py-0.5 -my-1">
                    <Hotkey shortcut={props.hotkey} />
                  </div>
                </Show>
                <Show when={props.standaloneHotkey}>
                  <div class="text-[0.625rem] text-ink-extra-muted rounded-sm ml-auto border border-ink/5 px-1.5 py-0.5 -my-1">
                    <Hotkey shortcut={props.hotkey} />
                  </div>
                </Show>
              </div>
            </div>
          </Show>
          <Show when={props.hotkeyVisible}>
            <div
              class={cn(
                'text-xs size-4 outline-1 outline-accent/50 rounded-xs bg-page text-ink flex items-center justify-center overflow-hidden',
                props.sidebarState === 'slim' && 'absolute -bottom-1 -right-1',
                props.sidebarState !== 'slim' && 'relative p-1 ml-auto'
              )}
            >
              <div class="absolute inset-0 size-full bg-accent/20" />
              <Hotkey shortcut={props.hotkey} />
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
