import { For, Show, type JSX, onMount, onCleanup } from 'solid-js';
import MacroIcon from '@macro-icons/macro-logo.svg';
import { Dynamic } from 'solid-js/web';
import { cn } from '@ui/utils/classname';
import {
  sidebarFilter,
  setSidebarFilter,
  type SandboxSidebarFilter,
} from '../sandbox/sandbox-store';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';
import { registerHotkey, createHotkeyGroup } from '@core/hotkey/hotkeys';
import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { Tooltip } from '@core/component/Tooltip';

export const MOCK_SIDEBAR_LINKS = [
  {
    id: 'channels',
    label: 'Channels',
    icon: AnimatedChannelIcon,
    hotkey: 'c',
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: AnimatedFileMdIcon,
    hotkey: 'd',
  },
  {
    id: 'mail',
    label: 'Emails',
    icon: AnimatedEmailIcon,
    hotkey: 'e',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: AnimatedTaskIcon,
    hotkey: 't',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: AnimatedStarIcon,
    hotkey: 'a',
  },
  {
    id: 'folders',
    label: 'Folders',
    icon: AnimatedFolderIcon,
    hotkey: 'f',
  },
] satisfies {
  id: SandboxSidebarFilter;
  label: string;
  icon: (props: {}) => JSX.Element;
  hotkey: ValidHotkey;
}[];

interface MockAppChromeProps {
  children?: JSX.Element;
  /** Called whenever the sidebar filter changes (click or hotkey). */
  onFilterChange?: (filter: SandboxSidebarFilter) => void;
}

export function MockAppChrome(props: MockAppChromeProps) {
  const displayTitle = () => {
    const filter = sidebarFilter();
    if (!filter) return 'All Items';
    const match = MOCK_SIDEBAR_LINKS.find((link) => link.id === filter);
    return match?.label ?? 'All Items';
  };

  const setFilter = (filter: SandboxSidebarFilter) => {
    setSidebarFilter(filter);
    props.onFilterChange?.(filter);
  };

  const group = createHotkeyGroup();

  onMount(() => {
    registerHotkey({
      hotkey: GO_TO_LEADER_KEY,
      scopeId: 'global',
      description: 'Go to page',
      keyDownHandler: () => false,
      activateCommandScopeId: GO_TO_COMMAND_SCOPE,
      hide: true,
      registrationType: 'add',
    }).withGroup(group);

    for (const link of MOCK_SIDEBAR_LINKS) {
      registerHotkey({
        hotkey: link.hotkey as ValidHotkey,
        scopeId: GO_TO_COMMAND_SCOPE,
        description: `Go to ${link.label}`,
        keyDownHandler: () => {
          setFilter(link.id as SandboxSidebarFilter);
          return true;
        },
      }).withGroup(group);
    }
  });

  onCleanup(() => group.dispose());

  return (
    <div class="size-full p-4 bg-panel">
      <div class="flex size-full bg-page rounded-sm border border-edge-muted">
        <div class="px-2 shrink-0 bg-surface-secondary/50 flex flex-col items-center py-3 gap-1">
          <MacroIcon class="size-5 text-accent mb-4" />
          <button
            type="button"
            class={cn(
              'size-6 text-ink rounded-xs p-1 transition-colors cursor-default hover:bg-ink/10',
              sidebarFilter() === null
                ? 'opacity-100 bg-ink/10 text-ink'
                : 'opacity-50 hover:opacity-80'
            )}
            onClick={(e) => {
              e.preventDefault();
              setFilter(null);
            }}
            title="All"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>
          <For each={MOCK_SIDEBAR_LINKS}>
            {(link) => {
              const isActive = () => sidebarFilter() === link.id;
              return (
                <Tooltip
                  tooltip={
                    <span class="flex items-center gap-1.5 text-xs">
                      {link.label}
                      <span class="flex items-center gap-1 text-ink/40">
                        <span class="px-1.5 rounded-sm border border-edge-muted">
                          G
                        </span>
                        then
                        <span class="px-1.5 rounded-sm border border-edge-muted">
                          {link.hotkey.toUpperCase()}
                        </span>
                      </span>
                    </span>
                  }
                  placement="right"
                >
                  <button
                    type="button"
                    class={cn(
                      'size-6 text-ink rounded-xs p-1 transition-colors cursor-default hover:bg-ink/10',
                      isActive()
                        ? 'opacity-100 bg-ink/10 text-ink'
                        : 'opacity-50 hover:opacity-80'
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      setFilter(link.id as SandboxSidebarFilter);
                    }}
                  >
                    {link.icon && (
                      <Dynamic component={link.icon} class="size-4" />
                    )}
                  </button>
                </Tooltip>
              );
            }}
          </For>
        </div>

        {/* Main area */}
        <div class="flex-1 min-w-0 flex flex-col m-1 ml-0 bg-panel border border-edge-muted rounded-sm">
          {/* Mock top bar */}
          <Show when={sidebarFilter() !== 'empty'}>
            <div class="h-10 shrink-0 border-b border-edge-muted flex items-center px-3">
              <span class="text-sm font-semibold text-ink/60">
                {displayTitle()}
              </span>
            </div>
          </Show>

          {/* Content area */}
          <div class="flex-1 min-h-0 overflow-y-auto">
            <Show
              when={sidebarFilter() !== 'empty'}
              fallback={
                <div class="flex items-center justify-center size-full">
                  <MacroIcon class="size-10 text-ink/10" />
                </div>
              }
            >
              {props.children}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
