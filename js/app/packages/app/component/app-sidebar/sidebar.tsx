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
    href: '/inbox',
    icon: TrayIcon,
  },
  {
    label: 'Agents',
    href: '/agents',
    icon: AnimatedChatIcon,
  },
  {
    label: 'Email',
    href: '/mail',
    icon: AnimatedEmailIcon,
  },
  {
    label: 'Documents',
    href: '/documents',
    icon: AnimatedFileMdIcon,
  },
  {
    label: 'Tasks',
    href: '/tasks',
    icon: AnimatedTaskIcon,
  },
  {
    label: 'Channels',
    href: '/channels',
    icon: AnimatedChannelIcon,
  },
  {
    label: 'Files',
    href: '/files',
    icon: AnimatedFolderIcon,
  },
] as const satisfies SidebarItem[];

export const AppSidebar = () => {
  return (
    <div class="w-56 h-full border-r-edge-muted border-r-1 bg-panel py-2">
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
    <A
      class="w-full px-2 py-1.5 rounded-md hover:bg-ink/10 active:bg-ink/20 flex items-center gap-2 text-sm text-ink-muted hover:text-ink"
      href={`/component${props.href}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      activeClass="bg-edge hover:!bg-edge"
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
