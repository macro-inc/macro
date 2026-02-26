import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import TrayIcon from '@phosphor-icons/core/bold/tray-bold.svg?component-solid';
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

export const AppSidebar = () => {
  const handleSearchClick = () => {};
  const handleCommandPaletteClick = () => {
    CommandState.toggle();
  };
  const handleCreateClick = () => {
    setCreateMenuOpen((p) => !p);
  };

  return (
    <div class="max-w-56 w-full h-full border-r-edge-muted border-r-1 bg-panel py-2 flex flex-col gap-4">
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
    </div>
  );
};

interface SidebarLinkProps extends SidebarItem {}

const SidebarLink = (props: SidebarLinkProps) => {
  const [isHovering, setIsHovering] = createSignal(false);
  return (
    <A
      class="w-full px-2 py-1.5 rounded-md flex items-center gap-2 text-sm hover:text-ink transition-colors"
      href={`/component${props.href}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      activeClass="bg-ink/10 text-white"
      inactiveClass="text-ink/70 hover:bg-ink/10 active:bg-ink/15"
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
