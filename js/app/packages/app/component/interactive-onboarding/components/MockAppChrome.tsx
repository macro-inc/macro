import { SIDEBAR_LINKS } from '@app/component/app-sidebar/sidebar';
import { For, type JSX } from 'solid-js';
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
import { AnimatedChatIcon } from '@macro-icons/wide/animating/chat';
import { AnimatedFolderIcon } from '@macro-icons/wide/animating/folder';

const MOCK_SIDEBAR_LINKS = [
  {
    id: 'documents',
    label: 'Documents',
    icon: AnimatedFileMdIcon,
  },
  {
    id: 'mail',
    label: 'Emails',
    icon: AnimatedEmailIcon,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: AnimatedTaskIcon,
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: AnimatedChatIcon,
  },
  {
    id: 'folders',
    label: 'Files',
    icon: AnimatedFolderIcon,
  },
] satisfies {
  id: SandboxSidebarFilter;
  label: string;
  icon: (props: {}) => JSX.Element;
}[];

interface MockAppChromeProps {
  children?: JSX.Element;
}

export function MockAppChrome(props: MockAppChromeProps) {
  const displayTitle = () => {
    const filter = sidebarFilter();
    if (!filter) return 'All Items';
    const match = MOCK_SIDEBAR_LINKS.find((link) => link.id === filter);
    return match?.label ?? 'All Items';
  };

  return (
    <div class="size-full p-4 bg-panel">
      <div class="flex size-full bg-page rounded-sm border border-edge-muted">
        <div class="px-3 shrink-0 bg-surface-secondary/50 flex flex-col items-center py-3 gap-3">
          <MacroIcon class="size-5 text-accent" />
          <button
            type="button"
            class={cn(
              'size-5 text-ink rounded-xs p-1 transition-colors cursor-default',
              sidebarFilter() === null
                ? 'opacity-100 bg-ink/10 text-ink'
                : 'opacity-50 hover:opacity-80'
            )}
            onClick={(e) => {
              e.preventDefault();
              setSidebarFilter(null);
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
                <button
                  type="button"
                  class={cn(
                    'size-5 text-ink rounded-xs p-1 transition-colors cursor-default',
                    isActive()
                      ? 'opacity-100 bg-ink/10 text-ink'
                      : 'opacity-50 hover:opacity-80'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    setSidebarFilter(link.id as SandboxSidebarFilter);
                  }}
                >
                  {link.icon && <Dynamic component={link.icon} />}
                </button>
              );
            }}
          </For>
        </div>

        {/* Main area */}
        <div class="flex-1 min-w-0 flex flex-col m-1 ml-0 bg-panel border border-edge-muted rounded-sm">
          {/* Mock top bar */}
          <div class="h-10 shrink-0 border-b border-edge-muted flex items-center px-3">
            <span class="text-sm font-semibold text-ink/60">
              {displayTitle()}
            </span>
          </div>

          {/* Content area */}
          <div class="flex-1 min-h-0 overflow-y-auto">{props.children}</div>
        </div>
      </div>
    </div>
  );
}
