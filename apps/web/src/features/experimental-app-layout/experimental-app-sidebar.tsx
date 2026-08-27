import { CommandState } from '@app/features/command';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSettingsState } from '@core/constant/SettingsState';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import LogoIcon from '@icon/macro-logo.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import BellIcon from '@phosphor/bell.svg';
import BookOpenIcon from '@phosphor/book-open.svg';
import CheckSquareIcon from '@phosphor/check-square.svg';
import EnvelopeIcon from '@phosphor/envelope-simple.svg';
import GearIcon from '@phosphor/gear.svg';
import GridIcon from '@phosphor/grid-four.svg';
import HouseIcon from '@phosphor/house.svg';
import LightningIcon from '@phosphor/lightning.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import TrayIcon from '@phosphor/tray.svg';
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
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ExperimentalFavoritesSection } from './experimental-favorites-section';

export type ExperimentalSidebarItemId =
  | 'home'
  | 'inbox'
  | 'activity'
  | 'library'
  | 'powers'
  | 'email'
  | 'tasks'
  | 'messages';

type ExperimentalSidebarItem = {
  id: ExperimentalSidebarItemId;
  label: string;
  contentId: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  params?: Record<string, unknown>;
};

/** The deliberately small, fixed information architecture for the experiment. */
export const EXPERIMENTAL_SIDEBAR_ITEMS: readonly ExperimentalSidebarItem[] = [
  { id: 'home', label: 'Home', contentId: 'home', icon: HouseIcon },
  { id: 'inbox', label: 'Inbox', contentId: 'inbox', icon: TrayIcon },
  {
    id: 'activity',
    label: 'Activity',
    contentId: 'activity',
    icon: BellIcon,
  },
  {
    id: 'library',
    label: 'Library',
    contentId: 'documents',
    icon: BookOpenIcon,
  },
  {
    id: 'powers',
    label: 'Powers',
    contentId: 'agents',
    icon: LightningIcon,
  },
  { id: 'email', label: 'Email', contentId: 'mail', icon: EnvelopeIcon },
  { id: 'tasks', label: 'Tasks', contentId: 'tasks', icon: CheckSquareIcon },
  {
    id: 'messages',
    label: 'Messages',
    contentId: 'channels',
    icon: MessagesIcon,
    params: {
      experimentalView: 'messages',
      initialTab: 'experimental-conversations',
    },
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
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const { openSettings } = useSettingsState();
  const currentDay = new Date().getDate();

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
    if (!content || content.type !== 'component') return false;
    if (item.id === 'messages') return content.id === 'channels';
    return content.id === item.contentId;
  };

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
    if (item.id === 'messages' && !event.shiftKey) {
      analytics.track('sidebar_click', { view: item.id });
      navigate('/channels');
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
        isExpanded() && 'w-60 max-w-60 px-3 pb-3 pt-3 opacity-100',
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
          'flex shrink-0 items-center',
          isExpanded()
            ? 'h-11 justify-between px-2'
            : 'flex-col justify-center gap-4 py-1'
        )}
      >
        <div
          class={cn(
            'flex items-center text-accent',
            isExpanded() ? 'gap-2.5' : 'justify-center'
          )}
        >
          <span class="flex size-8 items-center justify-center">
            <LogoIcon class="size-5" />
          </span>
        </div>
        <Show
          when={isExpanded()}
          fallback={
            <SidebarCreateMenu
              isSlim={isSlim}
              variant="icon"
              icon="plus"
              filled
              large={isSlim()}
              onAgentSelect={openChatView}
            />
          }
        >
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-[26px] rounded-full text-ink-muted hover:bg-ink/12 hover:text-ink! [&_svg]:size-3.5!"
              label="Calendar"
              tooltipPlacement="bottom"
              aria-label="Calendar"
              onClick={(event) => openUtilityView('calendar', event)}
            >
              <span class="relative flex size-4 items-center justify-center">
                <CalendarIcon class="size-4" />
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute left-1/2 top-[7px] -translate-x-1/2 text-[6px] font-bold leading-none"
                >
                  {currentDay}
                </span>
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-[26px] rounded-full text-ink-muted hover:bg-ink/12 hover:text-ink! [&_svg]:size-3.5!"
              label="Search"
              tooltipPlacement="bottom"
              aria-label="Search"
              onClick={(event) => openUtilityView('search', event)}
            >
              <SearchIcon />
            </Button>
            <SidebarCreateMenu
              isSlim={isSlim}
              variant="icon"
              icon="plus"
              filled
              onAgentSelect={openChatView}
            />
          </div>
        </Show>
      </header>

      <nav
        aria-label="App views"
        class="min-h-0 flex-1 overflow-y-auto"
      >
        <ul class="flex flex-col gap-1">
          <For each={EXPERIMENTAL_SIDEBAR_ITEMS}>
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
                      'group/nav-item flex h-10 w-full items-center rounded-lg font-medium outline-none transition-colors',
                      isExpanded() ? 'gap-3 px-3 text-left' : 'justify-center',
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
        <Show when={isExpanded()}>
          <div class="mt-4">
            <Suspense>
              <ExperimentalFavoritesSection />
            </Suspense>
          </div>
        </Show>
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
          <GridIcon />
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
