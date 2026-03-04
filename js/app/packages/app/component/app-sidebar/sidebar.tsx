import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import TrayIcon from '@phosphor-icons/core/bold/tray-bold.svg?component-solid';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';
import { useLocation } from '@solidjs/router';
import LogoIcon from '@macro-icons/macro-logo.svg';
import PlusIcon from '@macro-icons/wide/plus.svg';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import CommandIcon from '@phosphor-icons/core/assets/regular/command.svg';
import { LIST_VIEW_PATHS, type ListView } from '@app/constants/list-views';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { setCreateMenuOpen } from '@app/component/Launcher';
import { CommandState } from '@app/component/command';
import { cn } from '@ui/utils/classname';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { UnreadNotificationsWidget } from '@app/component/app-sidebar/unread-notifications-widget';
import { ChannelsUnreadWidget } from '@app/component/app-sidebar/channels-unread-widget';
import { globalSplitManager } from '@app/signal/splitLayout';
import { setSidebarOpen, sidebarOpen } from '@app/component/Layout';
import { isMobile } from '@core/mobile/isMobile';

interface SidebarItem {
  id: ListView;
  label: string;
  href: string;
  icon?: Component<
    JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
  >;
}

export const SIDEBAR_LINKS = [
  {
    id: 'inbox',
    label: 'Inbox',
    href: LIST_VIEW_PATHS.inbox,
    icon: TrayIcon,
  },
  {
    id: 'agents',
    label: 'Agents',
    href: LIST_VIEW_PATHS.agents,
    icon: AnimatedStarIcon,
  },
  {
    id: 'mail',
    label: 'Email',
    href: LIST_VIEW_PATHS.mail,
    icon: AnimatedEmailIcon,
  },
  {
    id: 'documents',
    label: 'Documents',
    href: LIST_VIEW_PATHS.documents,
    icon: AnimatedFileMdIcon,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    href: LIST_VIEW_PATHS.tasks,
    icon: AnimatedTaskIcon,
  },
  {
    id: 'channels',
    label: 'Channels',
    href: LIST_VIEW_PATHS.channels,
    icon: AnimatedChannelIcon,
  },
  {
    id: 'files',
    label: 'Files',
    href: LIST_VIEW_PATHS.files,
    icon: AnimatedFolderIcon,
  },
] as const satisfies SidebarItem[];

type AppSidebarProps = {
  expanded?: boolean;
};

export const AppSidebar = (props: AppSidebarProps) => {
  const layout = useSplitLayout();

  const handleCommandPaletteClick = () => {
    CommandState.toggle();
  };
  const handleCreateClick = () => {
    setCreateMenuOpen((p) => !p);
  };

  return (
    <>
      <Show when={isMobile() && sidebarOpen()}>
        <div
          class="absolute z-modal-overlay pattern-panel pattern-diagonal-4 w-screen h-full inset-0 bg-edge-muted mask-l-from-0 pointer-events-[all] transition-opacity opacity-100"
          onClick={() => setSidebarOpen(false)}
        />
      </Show>
      <div
        class={cn(
          'h-full bg-page pt-2 flex flex-col gap-4 mobile:absolute mobile:z-modal-content transition-[width_transform_opacity] duration-200 ease-in-out',
          props.expanded !== false
            ? 'max-w-56 w-full mobile:max-w-2/3 translate-x-0 opacity-100'
            : '-translate-x-full overflow-hidden opacity-0'
        )}
      >
        <div class="flex items-center justify-between py-2 pl-3 pr-2">
          <LogoIcon class="size-6 text-accent" />
          <div class="flex items-center gap-1">
            <Tooltip tooltip={<LabelAndHotKey label="Search" shortcut="/" />}>
              <Button
                as="a"
                variant="tertiary"
                size="icon-sm"
                href={`/component/search`}
                onClick={(e) => {
                  // Middle mouse handling
                  if (e.button === 1) return;

                  e.preventDefault();
                  layout.openWithSplit(
                    {
                      type: 'component',
                      id: 'search',
                    },
                    {
                      preferNewSplit: e.shiftKey,
                      mergeHistory: true,
                    }
                  );
                }}
              >
                <SearchIcon />
              </Button>
            </Tooltip>
            <Tooltip
              tooltip={<LabelAndHotKey label="Command palette" shortcut="⌘K" />}
            >
              <Button
                variant="tertiary"
                size="icon-sm"
                onClick={handleCommandPaletteClick}
              >
                <CommandIcon />
              </Button>
            </Tooltip>
            <Tooltip
              tooltip={<LabelAndHotKey label="Create new" shortcut="c" />}
            >
              <Button
                variant="tertiary"
                size="icon-sm"
                onClick={handleCreateClick}
              >
                <PlusIcon />
              </Button>
            </Tooltip>
          </div>
        </div>
        <nav>
          <ul class="w-full h-full px-2 flex flex-col gap-1">
            <For each={SIDEBAR_LINKS}>
              {(link) => (
                <li>
                  <SidebarLink {...link} />
                </li>
              )}
            </For>
          </ul>
        </nav>
        <div class="block max-h-[clamp(10%,60%,20rem)]">
          <ChannelsUnreadWidget />
        </div>

        <div class="block max-h-[clamp(10%,60%,20rem)] mt-auto">
          <UnreadNotificationsWidget />
        </div>
      </div>
    </>
  );
};

interface SidebarLinkProps extends SidebarItem {}

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
      variant="ghost"
      size="sm"
      class={cn(
        'w-full justify-start text-sm gap-2',
        isActive() && 'bg-ink/10 text-ink'
      )}
      href={`/component${props.href}`}
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
            mergeHistory: true,
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
    </Button>
  );
};
