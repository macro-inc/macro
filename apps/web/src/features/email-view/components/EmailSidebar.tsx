import { useViewTabHotkeys, ViewSidebar } from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArchiveIcon from '@phosphor/archive.svg';
import BellIcon from '@phosphor/bell-simple.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import ClockIcon from '@phosphor/clock.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FileIcon from '@phosphor/file.svg';
import PaperPlaneTiltIcon from '@phosphor/paper-plane-tilt.svg';
import StarIcon from '@phosphor/star.svg';
import FocusIcon from '@phosphor/target.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import SignalIcon from '@phosphor/wave-sine.svg';
import NoiseIcon from '@phosphor/waveform.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { pressHandlers } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { type Component, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { composeEmail } from '../compose-email';
import {
  EMAIL_FOCUS_TAB,
  EMAIL_TAB_IDS,
  EMAIL_TABS,
  type EmailTabItem,
} from '../constants';
import { useEmailView } from '../email-view-context';
import { EMAIL_TOUR } from '../tour';
import type { EmailTab } from '../types';
import { useVisibleEmailTab } from '../use-visible-email-tab';
import { EmailInboxList } from './EmailInboxSelector';

// Email is personal, so the sidebar lists only the user's own tags.
const SIDEBAR_TAG_SCOPES: readonly TagScope[] = ['user'];

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

function Tab(props: { item: EmailTabItem; onNavigate?: () => void }) {
  const { state, setTab } = useEmailView();

  return (
    <ViewSidebar.Item
      active={state.tab === props.item.id}
      {...pressHandlers(() => {
        setTab(props.item.id);
        props.onNavigate?.();
      })}
    >
      <ViewSidebar.Icon>
        <Dynamic component={TAB_ICONS[props.item.id]} class="size-4" />
      </ViewSidebar.Icon>
      <span class="truncate">{props.item.label}</span>
    </ViewSidebar.Item>
  );
}

export function EmailNavigation(props: { onNavigate?: () => void }) {
  const isVisible = useVisibleEmailTab();
  return (
    <ViewSidebar.Nav aria-label="Email tabs">
      <Show when={isVisible('focus')}>
        <Tab item={EMAIL_FOCUS_TAB} onNavigate={props.onNavigate} />
      </Show>
      <div
        ref={tourTarget(EMAIL_TOUR.signalNoise)}
        class="flex flex-col gap-(--sidebar-row-gap)"
      >
        <For each={EMAIL_TABS.slice(0, 2)}>
          {(item) => <Tab item={item} onNavigate={props.onNavigate} />}
        </For>
      </div>
      <For
        each={EMAIL_TABS.slice(2).filter(
          (tab) => tab.id !== 'focus' && isVisible(tab.id)
        )}
      >
        {(item) => <Tab item={item} onNavigate={props.onNavigate} />}
      </For>
    </ViewSidebar.Nav>
  );
}

export function EmailSidebar() {
  const isVisible = useVisibleEmailTab();
  const panel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();
  const {
    state,
    setTab,
    showTags,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  } = useEmailView();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => EMAIL_TAB_IDS.filter(isVisible),
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
        <ViewSidebar.Header>
          <div class="flex min-w-0 items-center gap-1">
            <ViewSidebar.CloseButton class="shrink-0" />
            <ViewSidebar.Title>Email</ViewSidebar.Title>
          </div>
        </ViewSidebar.Header>
      </Show>

      <ViewSidebar.Content>
        <EmailInboxList />

        <SidebarCreateButton
          label="New email"
          onCreate={() => composeEmail(openWithSplit, state.inboxIds)}
        />

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
