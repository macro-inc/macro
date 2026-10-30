import {
  SearchBar,
  useViewTabHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import FocusIcon from '@icon/system/regular/crosshair.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file.svg';
import PaperPlaneTiltIcon from '@icon/system/regular/paper-plane-tilt.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrayIcon from '@icon/system/regular/tray.svg';
import UsersThreeIcon from '@icon/system/regular/users-three.svg';
import SignalIcon from '@icon/system/regular/wave-sine.svg';
import NoiseIcon from '@icon/system/regular/waveform.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { Badge, pressHandlers } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { type Component, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { composeEmail } from '../compose-email';
import {
  EMAIL_FOCUS_TAB,
  EMAIL_INBOX_TAB_IDS,
  EMAIL_TAB_IDS,
  EMAIL_TAB_LABELS,
  EMAIL_TABS,
  isEmailInboxTab,
} from '../constants';
import { useEmailView } from '../email-view-context';
import { EMAIL_TOUR } from '../tour';
import type { EmailTab } from '../types';
import { useVisibleEmailTab } from '../use-visible-email-tab';
import { EmailInboxList } from './EmailInboxSelector';

// Email is personal, so the sidebar lists only the user's own tags.
const SIDEBAR_TAG_SCOPES: readonly TagScope[] = ['user'];
const PRIMARY_TAB_IDS = [
  'favorites',
  'drafts',
  'sent',
  'scheduled',
  'reminders',
] as const satisfies readonly EmailTab[];
const LIBRARY_TAB_IDS = [
  'all',
  'archived',
  'shared',
] as const satisfies readonly EmailTab[];
const DESKTOP_TAB_IDS = [
  'important',
  ...PRIMARY_TAB_IDS,
  ...LIBRARY_TAB_IDS,
] as const;

const TAB_ICONS: Record<EmailTab, Component<{ class?: string }>> = {
  important: SignalIcon,
  noise: NoiseIcon,
  favorites: StarIcon,
  sent: PaperPlaneTiltIcon,
  scheduled: ClockIcon,
  reminders: BellIcon,
  calendar: CalendarBlankIcon,
  drafts: FileIcon,
  shared: UsersThreeIcon,
  archived: ArchiveIcon,
  all: EnvelopeIcon,
  focus: FocusIcon,
};

function Tab(props: {
  id: EmailTab;
  label?: string;
  badge?: string;
  onNavigate?: () => void;
}) {
  const { state, setTab } = useEmailView();

  return (
    <ViewSidebar.Item
      active={state.tab === props.id}
      {...pressHandlers(() => {
        setTab(props.id);
        props.onNavigate?.();
      })}
    >
      <ViewSidebar.Icon>
        <Dynamic component={TAB_ICONS[props.id]} class="size-4" />
      </ViewSidebar.Icon>
      <span class="truncate">{props.label ?? EMAIL_TAB_LABELS[props.id]}</span>
      <Show when={props.badge}>
        {(badge) => (
          <Badge variant="outline" size="xs" class="ml-auto">
            {badge()}
          </Badge>
        )}
      </Show>
    </ViewSidebar.Item>
  );
}

export function EmailNavigation(props: { onNavigate?: () => void }) {
  const { state, setTab } = useEmailView();
  const isVisible = useVisibleEmailTab();
  return (
    <Show
      when={!isTouchDevice()}
      fallback={
        <ViewSidebar.Nav aria-label="Email tabs">
          <Show when={isVisible('focus')}>
            <Tab
              id="focus"
              badge={EMAIL_FOCUS_TAB.badge}
              onNavigate={props.onNavigate}
            />
          </Show>
          <div
            ref={tourTarget(EMAIL_TOUR.signalNoise)}
            class="flex flex-col gap-(--sidebar-row-gap)"
          >
            <For each={EMAIL_TABS.slice(0, 2)}>
              {(item) => <Tab id={item.id} onNavigate={props.onNavigate} />}
            </For>
          </div>
          <For
            each={EMAIL_TABS.slice(2).filter(
              (tab) => tab.id !== 'focus' && isVisible(tab.id)
            )}
          >
            {(item) => <Tab id={item.id} onNavigate={props.onNavigate} />}
          </For>
        </ViewSidebar.Nav>
      }
    >
      <ViewSidebar.Nav aria-label="Email tabs">
        <ViewSidebar.Item
          ref={tourTarget(EMAIL_TOUR.inbox)}
          active={isEmailInboxTab(state.tab)}
          {...pressHandlers(() => {
            // Reopen the Inbox view that was last open: Focus, Signal or Noise.
            setTab(isEmailInboxTab(state.tab) ? state.tab : 'important');
            props.onNavigate?.();
          })}
        >
          <ViewSidebar.Icon>
            <TrayIcon class="size-4" />
          </ViewSidebar.Icon>
          <span class="truncate">Inbox</span>
        </ViewSidebar.Item>
        <For each={PRIMARY_TAB_IDS.filter(isVisible)}>
          {(id) => <Tab id={id} onNavigate={props.onNavigate} />}
        </For>
      </ViewSidebar.Nav>
      <section aria-label="Library" class="shrink-0">
        <h2 class="flex h-(--sidebar-row-height) items-center px-(--sidebar-item-inset) text-xs font-medium text-ink-muted">
          Library
        </h2>
        <ViewSidebar.Nav
          aria-label="Email library"
          class="pt-(--sidebar-section-content-gap)"
        >
          <For each={LIBRARY_TAB_IDS}>
            {(id) => (
              <Tab
                id={id}
                label={id === 'all' ? 'All mail' : undefined}
                onNavigate={props.onNavigate}
              />
            )}
          </For>
        </ViewSidebar.Nav>
      </section>
    </Show>
  );
}

export function EmailSidebar() {
  const isVisible = useVisibleEmailTab();
  const panel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const {
    state,
    setState,
    setTab,
    showTags,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  } = useEmailView();

  const tabIds = () =>
    (isTouchDevice() ? EMAIL_TAB_IDS : DESKTOP_TAB_IDS).filter(isVisible);

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: tabIds,
    // Desktop groups the Inbox views under Inbox, so Tab moves between its
    // header tabs instead of walking the sidebar.
    sequentialIds: () =>
      isTouchDevice() ? tabIds() : EMAIL_INBOX_TAB_IDS.filter(isVisible),
    activeId: () => state.tab,
    setActiveId: setTab,
    shouldHandleSequentialKeyEvent: (event) =>
      !(
        event?.target instanceof Element &&
        event.target.closest('[role="grid"][aria-label="Email"]')
      ),
  });

  return (
    <ViewSidebar.Root aria-label="Email navigation">
      <Show when={!isTouchDevice()}>
        <ViewSidebar.Header
          searchLabel="Search email"
          search={() => (
            <SearchBar
              label="Search email"
              placeholder="Search email"
              value={state.search}
              onValueChange={(search) => setState('search', search)}
            />
          )}
        >
          <div class="flex min-w-0 items-center gap-1">
            <ViewSidebar.CloseButton class="shrink-0" />
            <ViewSidebar.Title>Email</ViewSidebar.Title>
          </div>
        </ViewSidebar.Header>
      </Show>

      <Show when={!isTouchDevice()}>
        <ViewSidebar.Primary>
          <SidebarCreateButton
            label="New email"
            onCreate={() => composeEmail(openWithSplit, state.inboxIds)}
          />
        </ViewSidebar.Primary>
      </Show>

      <ViewSidebar.Content>
        <EmailInboxList />

        <Show when={isTouchDevice()}>
          <SidebarCreateButton
            label="New email"
            onCreate={() => composeEmail(openWithSplit, state.inboxIds)}
          />
        </Show>

        <EmailNavigation />

        <div ref={tourTarget(EMAIL_TOUR.tags)}>
          <SidebarTagsSection
            activeIds={state.facets.tags ?? []}
            onActiveIdsChange={showTags}
            open={isSidebarSectionOpen('tags')}
            onOpenChange={(open) => setSidebarSectionOpen('tags', open)}
            scopes={SIDEBAR_TAG_SCOPES}
          />
        </div>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
