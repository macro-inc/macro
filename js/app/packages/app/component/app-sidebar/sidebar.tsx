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
import { AnimatedCommandIcon } from '@macro-icons/wide/animating/command';
import { useLocation } from '@solidjs/router';
import LogoIcon from '@macro-icons/macro-logo.svg';
import { LIST_VIEW_PATHS, type ListView } from '@app/constants/list-views';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { setCreateMenuOpen } from '@app/component/Launcher';
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

import { TOKENS } from '@core/hotkey/tokens';
import { Hotkey } from '@core/component/Hotkey';

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

type SidebarHotkeyDeps = {
  isSlim: () => boolean;
  onOpenChange: (open: boolean) => void;
  openWithSplit: ReturnType<typeof useSplitLayout>['openWithSplit'];
};

export const registerSidebarHotkeys = ({
  isSlim,
  onOpenChange,
  openWithSplit,
}: SidebarHotkeyDeps) => {
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
    runWithInputFocused: true,
    keyDownHandler: (e) => {
      e?.preventDefault();
      onOpenChange(isSlim());
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
      },
    });
  }
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

  const registerHotkeys = () =>
    registerSidebarHotkeys({
      isSlim,
      onOpenChange: props.onOpenChange,
      openWithSplit: layout.openWithSplit,
    });

  const isExpanded = () => props.sidebarState === 'expanded';
  const isSlim = () => props.sidebarState === 'slim';
  registerHotkeys();
  const [sidebarBtnHovering, setSidebarBtnHovering] = createSignal(false);
  const [createBtnHovering, setCreateBtnHovering] = createSignal(false);
  const [commandBtnHovering, setCommandBtnHovering] = createSignal(false);
  const [settingsBtnHovering, setSettingsBtnHovering] = createSignal(false);

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

      <div class=" w-full px-2 flex flex-col">
        <Button
          class="flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs py-1"
          variant="ghost"
          tooltipPlacement="right"
          tooltip={
            <LabelAndHotKey
              label="Create new"
              hotkeyToken={TOKENS.global.createCommand}
            />
          }
          onClick={handleCreateClick}
          onMouseEnter={() => setCreateBtnHovering(true)}
          onMouseLeave={() => setCreateBtnHovering(false)}
        >
          <div
            class={`size-4 shrink-0 transition-colors duration-300 ${createBtnHovering() ? 'text-accent' : ''}`}
          >
            <AnimatedPlusIcon triggerAnimation={createBtnHovering()} />
          </div>
          <span class="whitespace-nowrap group-data-[slim=true]/sidebar:invisible">
            Create
          </span>
          <div class="text-[0.625rem] text-ink-extra-muted/50 rounded-sm ml-auto border border-edge-muted px-1.5 py-0.25 -my-1 group-data-[slim=true]/sidebar:invisible">
            <Hotkey token={TOKENS.global.createCommand} class="flex gap-1" />
          </div>
        </Button>

        <Button
          class="flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs py-1"
          variant="ghost"
          tooltipPlacement="right"
          tooltip={
            <LabelAndHotKey
              label="Command palette"
              hotkeyToken={TOKENS.global.commandMenu}
            />
          }
          onClick={handleCommandPaletteClick}
          onMouseEnter={() => setCommandBtnHovering(true)}
          onMouseLeave={() => setCommandBtnHovering(false)}
        >
          <div
            class={`size-4 shrink-0 transition-colors duration-300 ${commandBtnHovering() ? 'text-accent' : ''}`}
          >
            <AnimatedCommandIcon triggerAnimation={commandBtnHovering()} />
          </div>
          <span class="whitespace-nowrap group-data-[slim=true]/sidebar:invisible">
            Command
          </span>
          <div class="text-[0.625rem] text-ink-extra-muted/50 rounded-sm ml-auto border border-edge-muted px-1.5 py-0.25 -my-1 group-data-[slim=true]/sidebar:invisible">
            <Hotkey token={TOKENS.global.commandMenu} class="flex gap-1" />
          </div>
        </Button>

        <Button
          class="flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs py-1"
          variant="ghost"
          tooltipPlacement="right"
          onClick={toggleSettings}
          onMouseEnter={() => setSettingsBtnHovering(true)}
          onMouseLeave={() => setSettingsBtnHovering(false)}
          tooltip={
            <LabelAndHotKey
              label="Settings"
              hotkeyToken={TOKENS.global.toggleSettings}
            />
          }
        >
          <div
            class={`size-4 shrink-0 transition-colors duration-300 ${settingsBtnHovering() ? 'text-accent' : ''}`}
          >
            <AnimatedGearIcon triggerAnimation={settingsBtnHovering()} />
          </div>
          <span class="whitespace-nowrap group-data-[slim=true]/sidebar:invisible">
            Settings
          </span>
          <div class="text-[0.625rem] text-ink-extra-muted/50 rounded-sm ml-auto border border-edge-muted px-1.5 py-0.25 -my-1 group-data-[slim=true]/sidebar:invisible">
            <Hotkey token={TOKENS.global.toggleSettings} class="flex gap-1" />
          </div>
        </Button>
      </div>
    </div>
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
      as="button"
      draggable={false}
      variant="ghost"
      class={cn(
        'flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-xs py-1',
        isActive() && 'bg-ink/7 not-disabled:hover:bg-ink/15 text-ink'
      )}
      tooltipPlacement="right"
      tooltip={
        <LabelAndHotKey
          label={`Go to ${props.label}`}
          hotkeySequence={
            props.standaloneHotkey
              ? [{ shortcut: props.hotkey }]
              : [{ shortcut: GO_TO_LEADER_KEY }, { shortcut: props.hotkey }]
          }
        />
      }
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

      <div class="text-[0.625rem] text-ink-extra-muted/50 rounded-sm ml-auto border border-edge-muted px-1.5 py-0.25 -my-1 group-data-[slim=true]/sidebar:invisible">
        <div class="flex gap-1">
          <Show when={!props.standaloneHotkey}>
            <>
              <Hotkey shortcut={GO_TO_LEADER_KEY} lowercase />
              <Hotkey shortcut={props.hotkey} lowercase />
            </>
          </Show>
          <Show when={props.standaloneHotkey}>
            <Hotkey shortcut={props.hotkey} lowercase />
          </Show>
        </div>
      </div>
    </Button>
  );
};
