import { useViewTabHotkeys, ViewSidebar } from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { AnimatedNoiseIcon } from '@icon/wide-noise';
import { AnimatedSignalIcon } from '@icon/wide-signal';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FileIcon from '@phosphor/file.svg';
import ComposeIcon from '@phosphor/note-pencil.svg';
import PaperPlaneTiltIcon from '@phosphor/paper-plane-tilt.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import { Button, pressHandlers } from '@ui';
import { type Component, For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { composeEmail } from '../compose-email';
import { EMAIL_TAB_IDS, EMAIL_TABS, type EmailTabItem } from '../constants';
import { useEmailView } from '../email-view-context';
import type { EmailTab } from '../types';
import { EmailInboxList } from './EmailInboxSelector';

const TAB_ICONS: Record<EmailTab, Component<{ class?: string }>> = {
  important: AnimatedSignalIcon,
  noise: AnimatedNoiseIcon,
  sent: PaperPlaneTiltIcon,
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
      <span aria-hidden="true" class="flex size-4 shrink-0 items-center">
        <Dynamic component={TAB_ICONS[props.item.id]} class="size-4" />
      </span>
      <span class="truncate">{props.item.label}</span>
    </ViewSidebar.Item>
  );
}

export function EmailNavigation(props: { onNavigate?: () => void }) {
  const { state, showTags, isSidebarSectionOpen, setSidebarSectionOpen } =
    useEmailView();

  return (
    <div class="flex flex-col gap-6">
      <ViewSidebar.Nav aria-label="Email tabs">
        <For each={EMAIL_TABS}>
          {(item) => <Tab item={item} onNavigate={props.onNavigate} />}
        </For>
      </ViewSidebar.Nav>

      <SidebarTagsSection
        activeIds={state.facets.tags ?? []}
        onActiveIdsChange={showTags}
        open={isSidebarSectionOpen('tags')}
        onOpenChange={(open) => setSidebarSectionOpen('tags', open)}
        onNavigate={props.onNavigate}
      />
    </div>
  );
}

export function EmailSidebar() {
  const panel = useSplitPanelOrThrow();
  const { state, setTab } = useEmailView();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => EMAIL_TAB_IDS,
    activeId: () => state.tab,
    setActiveId: setTab,
  });

  return (
    <ViewSidebar.Root aria-label="Email navigation" class="gap-4">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <SplitPanel.CloseButton />
          <ViewSidebar.Title>Email</ViewSidebar.Title>
        </div>
        <SplitPanel.ControlGroup>
          <SplitPanel.BackButton />
          <SplitPanel.ForwardButton />
        </SplitPanel.ControlGroup>
      </ViewSidebar.Header>

      <ViewSidebar.Content class="flex flex-col gap-6">
        <div class="flex flex-col gap-3">
          <EmailInboxList />
          <Button
            type="button"
            variant="ghost"
            depth={2}
            class="h-10 shrink-0 justify-start gap-3 rounded-xl bg-surface px-3"
            {...pressHandlers(() => composeEmail())}
          >
            <ComposeIcon class="size-4 shrink-0" />
            Compose
          </Button>
        </div>

        <EmailNavigation />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
