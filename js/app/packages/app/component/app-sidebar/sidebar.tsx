import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import TrayIcon from '@phosphor-icons/core/bold/tray-bold.svg?component-solid';
import SlidersIcon from '@phosphor-icons/core/regular/sliders.svg?component-solid';
import { AnimatedChatIcon } from '@macro-icons/wide/animating/chat';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';
import { A } from '@solidjs/router';
import LogoIcon from '@macro-icons/macro-logo.svg';
import PlusIcon from '@macro-icons/wide/plus.svg';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import CommandIcon from '@phosphor-icons/core/assets/regular/command.svg';
import { LIST_VIEW_PATHS } from '@app/constants/list-views';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { setCreateMenuOpen } from '@app/component/Launcher';
import { CommandState } from '@app/component/command';
import { cn } from '@ui/utils/classname';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { UnreadWidget } from '@app/component/app-sidebar/unread-widget';
import { ChannelsUnreadWidget } from '@app/component/app-sidebar/channels-unread-widget';

type UnreadWidgetType = 'channels' | 'all' | 'none';

const [activeUnreadWidget, setActiveUnreadWidget] =
  createSignal<UnreadWidgetType>('channels');

interface SidebarItem {
  label: string;
  href: string;
  icon?: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
  >;
}

export const SIDEBAR_LINKS = [
  {
    label: 'Inbox',
    href: LIST_VIEW_PATHS.inbox,
    icon: TrayIcon,
  },
  {
    label: 'Agents',
    href: LIST_VIEW_PATHS.agents,
    icon: AnimatedChatIcon,
  },
  {
    label: 'Email',
    href: LIST_VIEW_PATHS.mail,
    icon: AnimatedEmailIcon,
  },
  {
    label: 'Documents',
    href: LIST_VIEW_PATHS.documents,
    icon: AnimatedFileMdIcon,
  },
  {
    label: 'Tasks',
    href: LIST_VIEW_PATHS.tasks,
    icon: AnimatedTaskIcon,
  },
  {
    label: 'Channels',
    href: LIST_VIEW_PATHS.channels,
    icon: AnimatedChannelIcon,
  },
  {
    label: 'Files',
    href: LIST_VIEW_PATHS.files,
    icon: AnimatedFolderIcon,
  },
] as const satisfies SidebarItem[];

type AppSidebarProps = {
  expanded?: boolean;
};

export const AppSidebar = (props: AppSidebarProps) => {
  const handleSearchClick = () => {};

  const handleCommandPaletteClick = () => {
    CommandState.toggle();
  };
  const handleCreateClick = () => {
    setCreateMenuOpen((p) => !p);
  };

  return (
    <div
      class={cn(
        'h-full border-r-edge-muted border-r-1 bg-panel pt-2 flex flex-col gap-4 mobile:fixed mobile:z-modal-content transition-[width_transform_opacity] duration-200 ease-in-out',
        props.expanded !== false
          ? 'max-w-56 w-full mobile:max-w-2/3 translate-x-0 opacity-100'
          : '-translate-x-full overflow-hidden opacity-0'
      )}
    >
      <div class="flex items-center justify-between py-2 pl-3 pr-2">
        <LogoIcon class="size-6 text-accent" />
        <div class="flex items-center gap-1">
          <Tooltip tooltip={<LabelAndHotKey label="Search" shortcut="/" />}>
            <button
              type="button"
              class="flex items-center justify-center size-6 bg-ink/10 text-ink-muted hover:bg-ink/20 hover:text-ink rounded transition-colors"
              onClick={handleSearchClick}
            >
              <SearchIcon class="size-3.5" />
            </button>
          </Tooltip>
          <Tooltip
            tooltip={<LabelAndHotKey label="Command palette" shortcut="⌘K" />}
          >
            <button
              type="button"
              class="flex items-center justify-center size-6 bg-ink/10 text-ink-muted hover:bg-ink/20 hover:text-ink rounded transition-colors"
              onClick={handleCommandPaletteClick}
            >
              <CommandIcon class="size-3.5" />
            </button>
          </Tooltip>
          <Tooltip tooltip={<LabelAndHotKey label="Create new" shortcut="c" />}>
            <button
              type="button"
              class="flex items-center justify-center size-6 bg-ink/10 text-ink-muted hover:bg-ink/20 hover:text-ink rounded transition-colors"
              onClick={handleCreateClick}
            >
              <PlusIcon class="size-3.5" />
            </button>
          </Tooltip>
          <UnreadWidgetSelector />
        </div>
      </div>
      <nav>
        <ul class="w-full h-full px-2 flex flex-col">
          <For each={SIDEBAR_LINKS}>
            {(link) => (
              <li>
                <SidebarLink {...link} />
              </li>
            )}
          </For>
        </ul>
      </nav>
      {/* Unread Widget Section */}
      <Show when={activeUnreadWidget() === 'channels'}>
        <div class="block max-h-[clamp(10%,60%,20rem)]">
          <ChannelsUnreadWidget />
        </div>
      </Show>

      {/* Spacer to push UnreadWidget to bottom */}
      <Show when={activeUnreadWidget() === 'all'}>
        <div class="flex-1" />
      </Show>

      <Show when={activeUnreadWidget() === 'all'}>
        <div class="block max-h-[clamp(10%,60%,20rem)] border-t border-t-edge-muted">
          <UnreadWidget />
        </div>
      </Show>
    </div>
  );
};

/** Debug dropdown to switch between unread widget types */
const UnreadWidgetSelector = () => {
  const [isOpen, setIsOpen] = createSignal(false);

  const options: { value: UnreadWidgetType; label: string }[] = [
    { value: 'channels', label: 'Channels' },
    { value: 'all', label: 'All Notifications' },
    { value: 'none', label: 'None' },
  ];

  return (
    <div class="relative">
      <Tooltip tooltip="Widget selector">
        <button
          type="button"
          onClick={() => setIsOpen((p) => !p)}
          class={cn(
            'flex items-center justify-center size-6 bg-ink/10 text-ink-muted hover:bg-ink/20 hover:text-ink rounded transition-colors',
            isOpen() && 'bg-ink/20 text-ink'
          )}
        >
          <SlidersIcon class="size-3.5" />
        </button>
      </Tooltip>

      <Show when={isOpen()}>
        {/* Backdrop */}
        <div class="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />

        {/* Dropdown */}
        <div class="absolute top-full right-0 mt-1 w-40 bg-panel border border-edge-muted rounded shadow-lg z-20">
          <div class="px-2 py-1.5 text-xs text-ink-muted border-b border-edge-muted">
            Unread Widget
          </div>
          <For each={options}>
            {(option) => (
              <button
                type="button"
                onClick={() => {
                  setActiveUnreadWidget(option.value);
                  setIsOpen(false);
                }}
                class={cn(
                  'w-full px-2 py-1.5 text-xs text-left hover:bg-ink/10 transition-colors last:rounded-b',
                  activeUnreadWidget() === option.value
                    ? 'text-accent font-medium'
                    : 'text-ink-muted'
                )}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

interface SidebarLinkProps extends SidebarItem {}

const SidebarLink = (props: SidebarLinkProps) => {
  const [isHovering, setIsHovering] = createSignal(false);

  const layout = useSplitLayout();

  return (
    <A
      class="w-full px-2 py-1.5 rounded-md flex items-center gap-2 text-sm hover:text-ink transition-colors"
      href={`/component${props.href}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      activeClass="bg-ink/10 text-white"
      inactiveClass="text-ink/70 hover:bg-ink/10 active:bg-ink/15"
      onClick={(e) => {
        // Middle mouse handling
        if (e.button === 1) return;

        e.preventDefault();
        layout.openWithSplit(
          {
            id: props.href.slice(1),
            type: 'component',
          },
          {
            preferNewSplit: e.shiftKey,
          }
        );
      }}
    >
      <Show when={props.icon}>
        <div class="size-4">
          <Dynamic component={props.icon} triggerAnimation={isHovering()} />
        </div>
      </Show>
      {props.label}
    </A>
  );
};
