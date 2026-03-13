import GearIcon from '@phosphor-icons/core/regular/gear.svg?component-solid';
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
import { useLocation } from '@solidjs/router';
import LogoIcon from '@macro-icons/macro-logo.svg';
import PlusIcon from '@phosphor-icons/core/bold/plus-bold.svg?component-solid';
import CommandIcon from '@phosphor-icons/core/assets/regular/command.svg';
import { LIST_VIEW_PATHS, type ListView } from '@app/constants/list-views';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { setCreateMenuOpen } from '@app/component/Launcher';
import { CommandState } from '@app/component/command';
import { cn } from '@ui/utils/classname';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { ChannelsUnreadWidget } from '@app/component/app-sidebar/channels-unread-widget';
import { globalSplitManager } from '@app/signal/splitLayout';
import { isMobile } from '@core/mobile/isMobile';
import { useSettingsState } from '@core/constant/SettingsState';
import type { ValidHotkey } from '@core/hotkey/types';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import { ROUTER_BASE } from '@app/constants/routerBase';
import { TOKENS } from '@core/hotkey/tokens';

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
    id: 'files',
    label: 'Files',
    href: LIST_VIEW_PATHS.files,
    icon: AnimatedFolderIcon,
    hotkey: 'f',
  },
] satisfies SidebarItem[];

export type SidebarState = 'hidden' | 'expanded' | 'slim';

type AppSidebarProps = {
  sidebarState?: SidebarState;
  onOpenChange: (open: boolean) => void;
};

export const AppSidebar = (props: AppSidebarProps) => {
  const layout = useSplitLayout();
  const { toggleSettings } = useSettingsState();

  const handleCommandPaletteClick = () => {
    CommandState.toggle();
  };

  const handleCreateClick = () => {
    setCreateMenuOpen((p) => !p);
  };

  const registerHotkeys = () => {
    // Register 'g' as a leader key that activates the global GO_TO command scope
    registerHotkey({
      hotkey: GO_TO_LEADER_KEY,
      scopeId: 'global',
      description: 'Go to page',
      keyDownHandler: () => false,
      activateCommandScopeId: GO_TO_COMMAND_SCOPE,
      hide: true,
      registrationType: 'add',
    });

    registerHotkey({
      hotkey: 'cmd+.',
      scopeId: 'global',
      hotkeyToken: TOKENS.global.toggleSidebar,
      description: 'Toggle sidebar',
      keyDownHandler: (e) => {
        e?.preventDefault();
        props.onOpenChange(isSlim());
        return true;
      },
    });

    // Register navigation shortcuts in the global GO_TO command scope
    for (const link of SIDEBAR_LINKS) {
      registerHotkey({
        hotkey: link.hotkey,
        scopeId: link.standaloneHotkey ? 'global' : GO_TO_COMMAND_SCOPE,
        description: `Go to ${link.label}`,
        keyDownHandler: (e) => {
          e?.preventDefault();
          layout.openWithSplit(
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
        },
      });
    }
  };

  registerHotkeys();

  const isExpanded = () => props.sidebarState === 'expanded';
  const isSlim = () => props.sidebarState === 'slim';
  const [sidebarBtnHovering, setSidebarBtnHovering] = createSignal(false);

  return (
    <>
      <Show when={isMobile() && isExpanded()}>
        <div
          class="absolute z-modal-overlay pattern-panel pattern-diagonal-4 w-screen h-full inset-0 mask-l-from-0 pointer-events-[all] transition-opacity opacity-100"
          onClick={() => props.onOpenChange(false)}
        />
      </Show>
      <div
        class={cn(
          'group/sidebar h-full py-2 flex flex-col gap-0 mobile:absolute mobile:z-modal-content overflow-hidden',
          isExpanded() &&
            'max-w-56 w-full mobile:max-w-2/3 translate-x-0 opacity-100',
          props.sidebarState === 'hidden' &&
            '-translate-x-full overflow-hidden opacity-0',

          isSlim() &&
            'max-w-12 w-full mobile:max-w-2/3 translate-x-0 opacity-100'
        )}
        data-expanded={isExpanded()}
        data-slim={isSlim()}
        style={{ transition: 'max-width ease-in-out 100ms' }}
      >
        <div class="flex items-center justify-between py-2 pl-3 pr-2">
          <LogoIcon class="size-6 text-accent" />
        </div>

        <div class="px-2">
          <hr class="border-edge-muted mb-[8px]" />
        </div>

        <nav>
          <ul class="w-full h-full px-2 flex flex-col gap-1">
            <For each={SIDEBAR_LINKS}>
              {(link) => (
                <li class="flex items-center justify-center">
                  <SidebarLink
                    {...link}
                    sidebarState={props.sidebarState ?? 'expanded'}
                  />
                </li>
              )}
            </For>
          </ul>
        </nav>

        <div class="px-2">
          <hr class="border-edge-muted my-[8px]" />
        </div>

        <Show when={isExpanded()}>
          <div class="block max-h-[clamp(10%,60%,20rem)]">
            <ChannelsUnreadWidget />
          </div>

          {/* <div class="block max-h-[clamp(10%,60%,20rem)] mt-auto"> */}
          {/*   <UnreadNotificationsWidget /> */}
          {/* </div> */}
        </Show>

        <div class="px-2 mt-auto w-full">
          <hr class="border-edge-muted mb-[8px]" />
        </div>

        <div class=" w-full px-2 flex flex-col gap-1">
          <Tooltip
            class="w-full"
            tooltip={<LabelAndHotKey label="Create new" shortcut="c" />}
          >
            <Button
              class="flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs"
              variant="ghost"
              size="sm"
              onClick={handleCreateClick}
            >
              <PlusIcon class="size-4 shrink-0" />
              <span class="whitespace-nowrap group-data-[slim=true]/sidebar:invisible">
                Create
              </span>
            </Button>
          </Tooltip>

          <Show when={!isMobile()}>
            <Tooltip
              class="w-full"
              tooltip={
                <LabelAndHotKey
                  label="Command palette"
                  hotkeyToken={TOKENS.global.commandMenu}
                />
              }
            >
              <Button
                class="flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs"
                variant="ghost"
                size="sm"
                onClick={handleCommandPaletteClick}
              >
                <CommandIcon class="size-4 shrink-0" />
                <span class="whitespace-nowrap group-data-[slim=true]/sidebar:invisible">
                  Command
                </span>
              </Button>
            </Tooltip>
          </Show>

          <Tooltip
            class="w-full"
            tooltip={
              <LabelAndHotKey
                label="Settings"
                hotkeyToken="global.toggleSettings"
              />
            }
          >
            <Button
              class="flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs"
              variant="ghost"
              size="sm"
              onClick={toggleSettings}
            >
              <GearIcon class="size-4 shrink-0" />
              <span class="whitespace-nowrap group-data-[slim=true]/sidebar:invisible">
                Settings
              </span>
            </Button>
          </Tooltip>

          <Show when={!isMobile()}>
            <Tooltip
              class="w-full"
              tooltip={
                <LabelAndHotKey
                  label={isSlim() ? 'Expand sidebar' : 'Shrink Sidebar'}
                  hotkeyToken={TOKENS.global.toggleSidebar}
                />
              }
            >
              <Button
                class="flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs"
                variant="ghost"
                size="sm"
                onClick={() => props.onOpenChange(isSlim())}
                onMouseEnter={() => setSidebarBtnHovering(true)}
                onMouseLeave={() => setSidebarBtnHovering(false)}
              >
                <div class="shrink-0 [&_svg]:size-4">
                  <AnimatedSidebarIcon
                    triggerAnimation={sidebarBtnHovering()}
                  />
                </div>
                <span class="whitespace-nowrap group-data-[slim=true]/sidebar:invisible">
                  Sidebar
                </span>
              </Button>
            </Tooltip>
          </Show>
        </div>
      </div>
    </>
  );
};

interface SidebarLinkProps extends SidebarItem {
  sidebarState: SidebarState;
}

const SidebarLink = (props: SidebarLinkProps) => {
  const [isHovering, setIsHovering] = createSignal(false);

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

  return (
    <Button
      as="a"
      draggable={false}
      variant="ghost"
      size="sm"
      class={cn(
        'flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs',
        isActive() && 'bg-ink/7 not-disabled:hover:bg-ink/15 text-ink'
      )}
      href={`${ROUTER_BASE}/component${props.href}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={(e) => {
        // Middle mouse handling
        if (e.button === 1) return;

        e.preventDefault();
        layout.openWithSplit(
          {
            type: 'component',
            id: props.id,
          },
          {
            preferNewSplit: e.shiftKey,
            mergeHistory: false,
            allowDuplicate: true,
          }
        );
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
    </Button>
  );
};
