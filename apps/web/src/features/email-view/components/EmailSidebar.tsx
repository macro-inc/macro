import { useViewTabHotkeys, ViewSidebar } from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import ClockIcon from '@phosphor/clock.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FileIcon from '@phosphor/file.svg';
import PaperPlaneTiltIcon from '@phosphor/paper-plane-tilt.svg';
import StarIcon from '@phosphor/star.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import SignalIcon from '@phosphor/wave-sine.svg';
import NoiseIcon from '@phosphor/waveform.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import { pressHandlers } from '@ui';
import { type Component, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { composeEmail } from '../compose-email';
import { EMAIL_TAB_IDS, EMAIL_TABS, type EmailTabItem } from '../constants';
import { useEmailView } from '../email-view-context';
import type { EmailTab } from '../types';
import { EmailInboxList } from './EmailInboxSelector';

const TAB_ICONS: Record<EmailTab, Component<{ class?: string }>> = {
  important: SignalIcon,
  noise: NoiseIcon,
  favorites: StarIcon,
  sent: PaperPlaneTiltIcon,
  scheduled: ClockIcon,
  calendar: CalendarBlankIcon,
  drafts: FileIcon,
  shared: UsersThreeIcon,
  all: EnvelopeIcon,
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
  return (
    <ViewSidebar.Nav aria-label="Email tabs">
      <For each={EMAIL_TABS}>
        {(item) => <Tab item={item} onNavigate={props.onNavigate} />}
      </For>
    </ViewSidebar.Nav>
  );
}

export function EmailSidebar() {
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
    ids: () => EMAIL_TAB_IDS,
    activeId: () => state.tab,
    setActiveId: setTab,
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

        <SidebarTagsSection
          activeIds={state.facets.tags ?? []}
          onActiveIdsChange={showTags}
          open={isSidebarSectionOpen('tags')}
          onOpenChange={(open) => setSidebarSectionOpen('tags', open)}
        />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
