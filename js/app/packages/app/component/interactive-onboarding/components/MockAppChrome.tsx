import {
  For,
  Show,
  type JSX,
  onMount,
  onCleanup,
  createSignal,
} from 'solid-js';
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
import { AnimatedCommandIcon } from '@macro-icons/wide/animating/command';
import { AnimatedGearIcon } from '@macro-icons/wide/animating/gear';
import { AnimatedPlusIcon } from '@macro-icons/wide/animating/plus';
import { registerHotkey, createHotkeyGroup } from '@core/hotkey/hotkeys';
import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { Tooltip } from '@core/component/Tooltip';

export const MOCK_SIDEBAR_LINKS = [
  {
    id: 'agents',
    label: 'Agents',
    icon: AnimatedStarIcon,
    hotkey: 'a',
  },
  {
    id: 'mail',
    label: 'Emails',
    icon: AnimatedEmailIcon,
    hotkey: 'e',
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: AnimatedFileMdIcon,
    hotkey: 'd',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: AnimatedTaskIcon,
    hotkey: 't',
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: AnimatedChannelIcon,
    hotkey: 'c',
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
  /** When set, highlights that sidebar icon in accent color until activated. */
  highlightId?: SandboxSidebarFilter;
  /** Called when the command menu button at the bottom of the sidebar is clicked. If omitted, the button is inert. */
  onCommandClick?: () => void;
  /** When true, glows the command menu button until it's clicked for the first time. */
  highlightCommand?: boolean;
  /** Called when the create (+) button at the top of the sidebar is clicked. If omitted, the button is inert. */
  onCreateClick?: () => void;
  /** When true, glows the create button until it's clicked for the first time. */
  highlightCreate?: boolean;
}

export function MockAppChrome(props: MockAppChromeProps) {
  const displayTitle = () => {
    const filter = sidebarFilter();
    if (!filter) return 'All Items';
    const match = MOCK_SIDEBAR_LINKS.find((link) => link.id === filter);
    return match?.label ?? 'All Items';
  };

  // Tracks which highlight ids have been activated at least once so the glow
  // turns off permanently after the user interacts with that specific target.
  // Stored as a Set of ids so the component supports `highlightId` changing
  // between sidebar items — not just latching a single boolean.
  const [activatedHighlights, setActivatedHighlights] = createSignal<
    ReadonlySet<SandboxSidebarFilter>
  >(new Set());

  const setFilter = (filter: SandboxSidebarFilter) => {
    setSidebarFilter(filter);
    if (filter !== null && filter === props.highlightId) {
      setActivatedHighlights((prev) => {
        if (prev.has(filter)) return prev;
        const next = new Set(prev);
        next.add(filter);
        return next;
      });
    }
    props.onFilterChange?.(filter);
  };

  const [commandActivated, setCommandActivated] = createSignal(false);
  const isCommandHighlighted = () =>
    !!props.highlightCommand && !commandActivated();

  const [createActivated, setCreateActivated] = createSignal(false);
  const isCreateHighlighted = () =>
    !!props.highlightCreate && !createActivated();

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
      <style>{`
        @keyframes sidebar-glow-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgb(from var(--color-accent) r g b / 0.5), 0 0 8px 2px rgb(from var(--color-accent) r g b / 0.35); }
          50%      { box-shadow: 0 0 0 2px rgb(from var(--color-accent) r g b / 0.15), 0 0 14px 4px rgb(from var(--color-accent) r g b / 0.55); }
        }
        .sidebar-glow { animation: sidebar-glow-pulse 1.8s ease-in-out infinite; border-radius: 4px; }
      `}</style>
      <div class="flex size-full bg-page rounded-sm border border-edge-muted">
        <div class="px-2 shrink-0 bg-surface-secondary/50 flex flex-col items-center py-3 gap-1">
          <MacroIcon class="size-5 text-accent mb-3" />
          <button
            type="button"
            class={cn(
              'size-6 text-ink rounded-xs p-1 transition-colors cursor-default',
              isCreateHighlighted()
                ? 'opacity-100 hover:bg-ink/10 sidebar-glow'
                : 'opacity-50 hover:opacity-80 hover:bg-ink/10'
            )}
            onClick={(e) => {
              e.preventDefault();
              setCreateActivated(true);
              props.onCreateClick?.();
            }}
            title="Create"
          >
            <AnimatedPlusIcon />
          </button>
          <hr class="border-ink/5 w-full my-1" />
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
              const isHighlighted = () =>
                props.highlightId === link.id &&
                !activatedHighlights().has(link.id);
              const stateClass = () => {
                if (isActive()) {
                  return 'opacity-100 bg-ink/10 text-ink hover:bg-ink/10';
                }
                if (isHighlighted()) {
                  return 'opacity-100 text-ink hover:bg-ink/10 sidebar-glow';
                }
                return 'text-ink opacity-50 hover:opacity-80 hover:bg-ink/10';
              };
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
                      'size-6 rounded-xs p-1 transition-colors cursor-default',
                      stateClass()
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

          <div class="mt-auto flex flex-col items-center gap-1">
            <button
              type="button"
              class={cn(
                'size-6 text-ink rounded-xs p-1 transition-colors cursor-default',
                isCommandHighlighted()
                  ? 'opacity-100 hover:bg-ink/10 sidebar-glow'
                  : 'opacity-50 hover:opacity-80 hover:bg-ink/10'
              )}
              onClick={(e) => {
                e.preventDefault();
                setCommandActivated(true);
                props.onCommandClick?.();
              }}
              title="Command Menu"
            >
              <AnimatedCommandIcon />
            </button>
            <button
              type="button"
              class="size-6 text-ink rounded-xs p-1 transition-colors cursor-default opacity-50 hover:opacity-80 hover:bg-ink/10"
              onClick={(e) => e.preventDefault()}
              title="Settings"
            >
              <AnimatedGearIcon />
            </button>
          </div>
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
