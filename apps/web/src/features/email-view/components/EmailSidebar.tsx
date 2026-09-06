import { useViewTabHotkeys, ViewSidebar } from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import BellSlashIcon from '@phosphor/bell-slash.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import NotePencilIcon from '@phosphor/note-pencil.svg';
import PaperPlaneTiltIcon from '@phosphor/paper-plane-tilt.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrayIcon from '@phosphor/tray.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { Button } from '@ui';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { composeEmail } from '../compose-email';
import { EMAIL_TAB_IDS, EMAIL_TABS, type EmailTabItem } from '../constants';
import { useEmailView } from '../email-view-context';
import type { EmailTab } from '../types';
import { EmailInboxSelector } from './EmailInboxSelector';

const TAB_ICONS: Record<EmailTab, typeof TrayIcon> = {
  important: TrayIcon,
  noise: BellSlashIcon,
  sent: PaperPlaneTiltIcon,
  calendar: CalendarBlankIcon,
  drafts: NotePencilIcon,
  shared: UsersThreeIcon,
  all: EnvelopeIcon,
};

function Tab(props: { item: EmailTabItem; onNavigate?: () => void }) {
  const { state, setTab } = useEmailView();

  return (
    <ViewSidebar.Item
      active={state.tab === props.item.id}
      onClick={() => {
        setTab(props.item.id);
        props.onNavigate?.();
      }}
    >
      <Dynamic
        component={TAB_ICONS[props.item.id]}
        aria-hidden="true"
        class="size-4 shrink-0"
      />
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
  const { state, setTab } = useEmailView();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => EMAIL_TAB_IDS,
    activeId: () => state.tab,
    setActiveId: setTab,
  });

  return (
    <ViewSidebar.Root
      aria-label="Email navigation"
      class="gap-4 border-r-0 pt-2"
    >
      <SplitPanel.ControlGroup>
        <SplitPanel.CloseButton />
        <SplitPanel.BackButton />
        <SplitPanel.ForwardButton />
      </SplitPanel.ControlGroup>

      <ViewSidebar.Header>
        <ViewSidebar.Title>Email</ViewSidebar.Title>
        <Button
          type="button"
          variant="cta"
          size="md"
          class="rounded-lg px-3"
          onClick={composeEmail}
        >
          <PlusIcon class="size-4 shrink-0" />
          New
        </Button>
      </ViewSidebar.Header>

      <ViewSidebar.Content class="flex flex-col gap-3 pt-1">
        <EmailInboxSelector variant="sidebar" />
        <EmailNavigation />
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
