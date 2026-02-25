import { Component, createSignal, For, JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import TrayIcon from '@phosphor-icons/core/regular/tray.svg?component-solid';
import { AnimatedChatIcon } from '@macro-icons/wide/animating/chat';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';

interface SidebarItem {
  label: string;
  href: string;
  icon?: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
  >;
}

const SIDEBAR_LINKS: SidebarItem[] = [
  {
    label: 'Inbox',
    href: '',
    icon: TrayIcon,
  },
  {
    label: 'Agents',
    href: '',
    icon: AnimatedChatIcon,
  },
  {
    label: 'Email',
    href: '',
    icon: AnimatedEmailIcon,
  },
  {
    label: 'Documents',
    href: '',
    icon: AnimatedFileMdIcon,
  },
  {
    label: 'Tasks',
    href: '',
    icon: AnimatedTaskIcon,
  },
  {
    label: 'Channels',
    href: '',
    icon: AnimatedChannelIcon,
  },
  {
    label: 'Files',
    href: '',
    icon: AnimatedFolderIcon,
  },
];

export const AppSidebar = () => {
  return (
    <div class="w-64 h-full border-r-edge-muted border-r-1 bg-panel py-2">
      <div class="w-full h-full px-2 flex flex-col">
        <For each={SIDEBAR_LINKS}>{(link) => <SidebarLink {...link} />}</For>
      </div>
    </div>
  );
};

interface SidebarLinkProps extends SidebarItem {}

const SidebarLink = (props: SidebarLinkProps) => {
  const [isHovering, setIsHovering] = createSignal(false);
  return (
    <a
      class="w-full p-2 rounded-lg hover:bg-edge-muted active:bg-edge flex items-center gap-2 text-sm text-ink"
      href={props.href}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <Show when={props.icon}>
        <div class="size-4">
          <Dynamic component={props.icon} triggerAnimation={isHovering()} />
        </div>
      </Show>
      {props.label}
    </a>
  );
};
