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
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import LogoIcon from '@icon/macro-logo.svg';
import { AnimatedSquareSidebarIcon } from '@icon/square-sidebar';
import { AnimatedActivityIcon } from '@icon/wide-activity';
import WideBotIcon from '@icon/wide-bot.svg';
import WideCalendarIcon from '@icon/wide-calendar.svg';
import WideChatIcon from '@icon/wide-chat.svg';
import WideCompanyIcon from '@icon/wide-company.svg';
import WideEmailIcon from '@icon/wide-email.svg';
import WideTaskIcon from '@icon/wide-task.svg';
import DriveIcon from '@phosphor/shipping-container.svg';
import { useNavigate } from '@solidjs/router';
import { cn, Tooltip } from '@ui';
import {
  type Component,
  createMemo,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
export type ExperimentalSidebarItemId =
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
  icon: Component<{ class?: string; triggerAnimation?: boolean }>;
  params?: Record<string, unknown>;
};

/** V4's capability-oriented app information architecture. */
export const EXPERIMENTAL_SIDEBAR_ITEMS: readonly ExperimentalSidebarItem[] = [
  {
    id: 'activity',
    label: 'Activity',
    contentId: 'activity',
    icon: AnimatedActivityIcon,
  },
  { id: 'drive', label: 'Drive', contentId: 'documents', icon: DriveIcon },
  { id: 'email', label: 'Email', contentId: 'mail', icon: WideEmailIcon },
  {
    id: 'chat',
    label: 'Chat',
    contentId: 'channels',
    icon: WideChatIcon,
    params: {
      experimentalView: 'messages',
      initialTab: 'experimental-conversations',
    },
  },
  { id: 'tasks', label: 'Tasks', contentId: 'tasks', icon: WideTaskIcon },
  {
    id: 'calendar',
    label: 'Calendar',
    contentId: CALENDAR_BLOCK_ID,
    icon: WideCalendarIcon,
  },
  { id: 'brain', label: 'Brain', contentId: 'agents', icon: WideBotIcon },
  {
    id: 'crm',
    label: 'CRM',
    contentId: 'companies',
    icon: WideCompanyIcon,
  },
];

const SIDEBAR_TRANSITION =
  'max-width 220ms cubic-bezier(0.4, 0, 0.2, 1), width 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 160ms ease-in-out, transform 220ms cubic-bezier(0.4, 0, 0.2, 1)';

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

  const openCalendarView = (event: MouseEvent) => {
    analytics.track('sidebar_click', { view: 'calendar' });
    layout.openWithSplit(
      { type: 'calendar', id: CALENDAR_BLOCK_ID },
      {
        preferNewSplit: event.shiftKey,
        mergeHistory: false,
        allowDuplicate: false,
        referredFrom: 'sidebar',
      }
    );
    globalSplitManager()?.returnFocus();
  };

  const openItem = (item: ExperimentalSidebarItem, event: MouseEvent) => {
    if (item.id === 'calendar') {
      openCalendarView(event);
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
        'group/experimental-sidebar relative flex h-full shrink-0 flex-col overflow-hidden bg-page text-sm will-change-[width,max-width]',
        isExpanded() && 'w-56 max-w-56 p-2 opacity-100',
        isSlim() && 'w-16 max-w-16 p-2 opacity-100',
        props.sidebarState === 'hidden' &&
          'fixed inset-y-0 left-0 w-0 max-w-0 -translate-x-full opacity-0 pointer-events-none'
      )}
      data-expanded={isExpanded()}
      data-slim={isSlim()}
      style={{ transition: SIDEBAR_TRANSITION }}
    >
      <header class="mb-2 flex h-9 shrink-0 items-center px-1">
        <div
          class={cn(
            'relative size-8 shrink-0 transition-transform duration-[220ms]',
            isSlim() && 'translate-x-1'
          )}
        >
          <span
            class={cn(
              'absolute inset-0 flex items-center justify-center text-accent transition-[opacity,transform] duration-[220ms]',
              isExpanded()
                ? 'opacity-100'
                : 'pointer-events-none opacity-0'
            )}
          >
            <LogoIcon class="size-5" />
          </span>
          <button
            type="button"
            class={cn(
              'absolute inset-0 flex size-8 items-center justify-center rounded-xl text-ink-muted outline-none transition-[opacity,transform,background-color,color] duration-[220ms] hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40',
              isSlim()
                ? 'opacity-100'
                : 'pointer-events-none opacity-0'
            )}
            aria-label="Expand sidebar"
            tabIndex={isSlim() ? 0 : -1}
            onClick={() => props.onOpenChange(true)}
          >
            <AnimatedSquareSidebarIcon class="size-3.5" />
          </button>
        </div>
        <div
          class={cn(
            'ml-auto flex shrink-0 items-center overflow-hidden transition-[max-width,opacity] duration-[220ms]',
            isExpanded()
              ? 'max-w-8 opacity-100'
              : 'pointer-events-none max-w-0 opacity-0'
          )}
          aria-hidden={isSlim()}
        >
          <button
            type="button"
            class="flex size-8 items-center justify-center rounded-xl text-ink-muted outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label="Use slim sidebar"
            tabIndex={isExpanded() ? 0 : -1}
            onClick={() => props.onOpenChange(false)}
          >
            <AnimatedSquareSidebarIcon class="size-3.5" />
          </button>
        </div>
      </header>

      <nav aria-label="App views" class="min-h-0 flex-1 overflow-y-auto">
        <ul class="flex flex-col gap-0.5">
          <li class="mb-2 flex w-full px-1">
            <SidebarCreateMenu
              isSlim={isSlim}
              variant="row"
              icon="plus"
              animateSlimLabel
              triggerClass={cn(
                'h-9 rounded-xl transition-[width,gap,padding] duration-[220ms]',
                isExpanded()
                  ? 'px-3 py-2.5'
                  : 'mx-auto w-9 gap-0 px-2.5 py-0'
              )}
              onAgentSelect={openChatView}
            />
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
                      'group/nav-item relative flex h-9 items-center rounded-xl outline-none transition-[width,padding,gap,background-color,color] duration-[220ms]',
                      isExpanded()
                        ? 'w-full gap-2.5 px-3 py-2.5 text-left'
                        : 'mx-auto w-9 gap-0 px-2.5 py-0 text-left',
                      isActive(item)
                        ? 'bg-active font-medium text-ink'
                        : 'font-normal text-ink-muted hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40'
                    )}
                    aria-current={isActive(item) ? 'page' : undefined}
                    aria-label={isSlim() ? item.label : undefined}
                    onMouseDown={(event) => {
                      if (event.button === 0) event.preventDefault();
                    }}
                    onClick={(event) => openItem(item, event)}
                  >
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <Dynamic component={item.icon} class="size-4" />
                    </span>
                    <span
                      class={cn(
                        'min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-[220ms]',
                        isExpanded()
                          ? 'max-w-40 opacity-100'
                          : 'max-w-0 opacity-0'
                      )}
                    >
                      {item.label}
                    </span>
                    <Show when={isActive(item)}>
                      <span
                        aria-hidden="true"
                        class={cn(
                          'absolute top-1/2 z-10 h-4 w-2 -translate-y-1/2 rounded-r-full bg-ink',
                          isExpanded() ? '-left-2' : '-left-3.5'
                        )}
                      />
                    </Show>
                  </button>
                </Tooltip>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </aside>
  );
}
