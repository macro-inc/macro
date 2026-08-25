import { CommandState } from '@app/features/command';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import {
  buildBrainWorkspacePath,
  getLastBrainWorkspaceSelection,
} from '@components/app/split-layout/brainWorkspaceRoute';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  ENABLE_CRM_FLAG,
  ENABLE_CRM_OVERRIDE,
} from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import LogoIcon from '@icon/macro-logo.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import BellIcon from '@phosphor/bell.svg';
import BrainIcon from '@phosphor/brain.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CommandIcon from '@phosphor/command.svg';
import EnvelopeIcon from '@phosphor/envelope-simple.svg';
import GearIcon from '@phosphor/gear.svg';
import DriveIcon from '@phosphor/shipping-container.svg';
import TasksIcon from '@phosphor/list-checks.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import MessagesIcon from '@phosphor/chats-circle.svg';
import { useNavigate } from '@solidjs/router';
import { Button, cn, Tooltip } from '@ui';
import {
  type Component,
  createMemo,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
export type ExperimentalSidebarItemId =
  | 'search'
  | 'activity'
  | 'brain'
  | 'calendar'
  | 'email'
  | 'chat'
  | 'drive'
  | 'tasks'
  | 'crm';

type ExperimentalSidebarItem = {
  id: ExperimentalSidebarItemId;
  label: string;
  contentId: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  params?: Record<string, unknown>;
};

/** V2's capability-oriented app information architecture. */
export const EXPERIMENTAL_SIDEBAR_ITEMS: readonly ExperimentalSidebarItem[] = [
  { id: 'search', label: 'Search', contentId: 'search', icon: SearchIcon },
  { id: 'activity', label: 'Activity', contentId: 'activity', icon: BellIcon },
  { id: 'drive', label: 'Drive', contentId: 'documents', icon: DriveIcon },
  { id: 'email', label: 'Email', contentId: 'mail', icon: EnvelopeIcon },
  {
    id: 'chat',
    label: 'Chat',
    contentId: 'channels',
    icon: MessagesIcon,
    params: {
      experimentalView: 'messages',
      initialTab: 'experimental-conversations',
    },
  },
  { id: 'tasks', label: 'Tasks', contentId: 'tasks', icon: TasksIcon },
  {
    id: 'calendar',
    label: 'Calendar',
    contentId: CALENDAR_BLOCK_ID,
    icon: CalendarIcon,
  },
  { id: 'brain', label: 'Brain', contentId: 'agents', icon: BrainIcon },
  {
    id: 'crm',
    label: 'CRM',
    contentId: 'companies',
    icon: BuildingsIcon,
  },
];

const SIDEBAR_TRANSITION =
  'max-width ease-in-out 140ms, width ease-in-out 140ms, opacity ease-in-out 120ms, transform ease-in-out 120ms';

type ExperimentalAppSidebarProps = {
  sidebarState?: SidebarState;
  onOpenChange: (open: boolean) => void;
  overlayOpen?: boolean;
  onOverlayOpenChange?: (open: boolean) => void;
};

/** A separate app sidebar used only while the local layout experiment is on. */
export function ExperimentalAppSidebar(props: ExperimentalAppSidebarProps) {
  const analytics = useAnalytics();
  const crmFlag = useFeatureFlag(ENABLE_CRM_FLAG, {
    enabledOverride: ENABLE_CRM_OVERRIDE,
  });
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const { openSettings } = useSettingsState();

  const isExpanded = () => props.sidebarState === 'expanded';
  const isSlim = () => props.sidebarState === 'slim';

  const sidebarHotkeyRegistration = registerHotkey({
    hotkey: 'cmd+.',
    scopeId: 'global',
    hotkeyToken: TOKENS.global.toggleSidebar,
    description: 'Toggle sidebar',
    runWithInputFocused: true,
    keyDownHandler: (event) => {
      event?.preventDefault();
      props.onOpenChange(isSlim());
      return true;
    },
  });
  onCleanup(sidebarHotkeyRegistration.dispose);

  const activeContent = createMemo(() =>
    globalSplitManager()?.activeSplit()?.content()
  );

  const isActive = (item: ExperimentalSidebarItem) => {
    const content = activeContent();
    if (!content) return false;
    if (item.id === 'calendar') {
      return content.type === 'calendar' && content.id === CALENDAR_BLOCK_ID;
    }
    return content.type === 'component' && content.id === item.contentId;
  };

  const visibleItems = () =>
    EXPERIMENTAL_SIDEBAR_ITEMS.filter(
      (item) => item.id !== 'crm' || crmFlag().enabled
    );

  const openChatView = () => {
    analytics.track('sidebar_click', { view: 'chat' });
    navigate('/chat');
  };

  const openUtilityView = (
    view: 'calendar' | 'search',
    event: MouseEvent
  ) => {
    analytics.track('sidebar_click', { view });
    layout.openWithSplit(
      view === 'calendar'
        ? { type: 'calendar', id: CALENDAR_BLOCK_ID }
        : { type: 'component', id: 'search' },
      {
        preferNewSplit: event.shiftKey,
        mergeHistory: false,
        allowDuplicate: view !== 'calendar',
        referredFrom: 'sidebar',
      }
    );
    globalSplitManager()?.returnFocus();
  };

  const openItem = (item: ExperimentalSidebarItem, event: MouseEvent) => {
    if (item.id === 'calendar' || item.id === 'search') {
      openUtilityView(item.id, event);
      return;
    }

    if (item.id === 'brain' && !event.shiftKey && !isActive(item)) {
      analytics.track('sidebar_click', { view: item.id });
      navigate(buildBrainWorkspacePath(getLastBrainWorkspaceSelection()));
      globalSplitManager()?.returnFocus();
      return;
    }

    if (!event.shiftKey && isActive(item)) {
      globalSplitManager()?.returnFocus();
      return;
    }

    analytics.track('sidebar_click', { view: item.id });
    layout.openWithSplit(
      {
        type: 'component',
        id: item.contentId,
        params: item.params,
      },
      {
        preferNewSplit: event.shiftKey,
        mergeHistory: false,
        allowDuplicate: true,
        referredFrom: 'sidebar',
      }
    );
    globalSplitManager()?.returnFocus();
  };

  return (
    <aside
      class={cn(
        'group/experimental-sidebar relative flex h-full shrink-0 flex-col overflow-hidden bg-page text-sm',
        isExpanded() && 'w-56 max-w-56 px-3 pb-3 pt-3 opacity-100',
        isSlim() && 'w-16 max-w-16 px-2 pb-3 pt-3 opacity-100',
        props.sidebarState === 'hidden' &&
          'fixed inset-y-0 left-0 w-0 max-w-0 -translate-x-full opacity-0 pointer-events-none'
      )}
      data-expanded={isExpanded()}
      data-slim={isSlim()}
      style={{ transition: SIDEBAR_TRANSITION }}
    >
      <header
        class={cn(
          'mb-2 flex h-11 shrink-0 items-center text-accent',
          isExpanded() ? 'px-2' : 'justify-center'
        )}
      >
        <span class="flex size-8 items-center justify-center">
          <LogoIcon class="size-5" />
        </span>
      </header>

      <nav aria-label="App views" class="min-h-0 flex-1 overflow-y-auto">
        <ul class="flex flex-col gap-1">
          <li
            class={cn(
              'mb-2 flex w-full',
              isExpanded() ? 'px-1' : 'justify-center'
            )}
          >
            <Show
              when={isExpanded()}
              fallback={
                <SidebarCreateMenu
                  isSlim={isSlim}
                  variant="icon"
                  icon="plus"
                  filled
                  large
                  onAgentSelect={openChatView}
                />
              }
            >
              <SidebarCreateMenu
                isSlim={isSlim}
                variant="row"
                icon="plus"
                onAgentSelect={openChatView}
              />
            </Show>
          </li>
          <For each={visibleItems()}>
            {(item) => (
              <li>
                <Tooltip
                  label={item.label}
                  placement="right"
                  class="w-full"
                  disabled={isExpanded()}
                >
                  <button
                    type="button"
                    class={cn(
                      'group/nav-item flex items-center rounded-lg font-medium outline-none transition-colors',
                      isExpanded()
                        ? 'h-10 w-full gap-3 px-3 text-left'
                        : 'mx-auto size-9 justify-center',
                      isActive(item)
                        ? 'bg-active text-ink'
                        : 'text-ink-muted hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40'
                    )}
                    aria-current={isActive(item) ? 'page' : undefined}
                    aria-label={isSlim() ? item.label : undefined}
                    onMouseDown={(event) => {
                      if (event.button === 0) event.preventDefault();
                    }}
                    onClick={(event) => openItem(item, event)}
                  >
                    <span class="flex size-5 shrink-0 items-center justify-center">
                      <Dynamic component={item.icon} class="size-4" />
                    </span>
                    <Show when={isExpanded()}>
                      <span class="truncate">{item.label}</span>
                    </Show>
                  </button>
                </Tooltip>
              </li>
            )}
          </For>
        </ul>
      </nav>

      <footer
        class={cn(
          'mt-4 flex shrink-0 border-t border-edge-muted/70 pt-3',
          isExpanded()
            ? 'items-center gap-1 px-1'
            : 'flex-col items-center gap-1'
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          class="rounded-lg text-ink-muted"
          label="Command menu"
          tooltipPlacement="right"
          aria-label="Command menu"
          onClick={() => CommandState.open()}
        >
          <CommandIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="rounded-lg text-ink-muted"
          label="Settings"
          tooltipPlacement="right"
          aria-label="Settings"
          onClick={() => openSettings('Account')}
        >
          <GearIcon />
        </Button>
        <Show when={isExpanded()}>
          <div class="flex-1" />
        </Show>
        <Button
          variant="ghost"
          size="icon-sm"
          class="rounded-lg text-ink-muted"
          label={isSlim() ? 'Expand sidebar' : 'Use slim sidebar'}
          tooltipPlacement="right"
          aria-label={isSlim() ? 'Expand sidebar' : 'Use slim sidebar'}
          onClick={() => props.onOpenChange(isSlim())}
        >
          <Show when={isSlim()} fallback={<ArrowLeftIcon />}>
            <ArrowRightIcon />
          </Show>
        </Button>
      </footer>
    </aside>
  );
}
