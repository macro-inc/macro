import { useViewTabHotkeys, ViewSidebar } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { enableReminders } from '@core/constant/featureFlags';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file.svg';
import PaperPlaneTiltIcon from '@icon/system/regular/paper-plane-tilt.svg';
import StarIcon from '@icon/system/regular/star.svg';
import UsersThreeIcon from '@icon/system/regular/users-three.svg';
import SignalIcon from '@icon/system/regular/wave-sine.svg';
import NoiseIcon from '@icon/system/regular/waveform.svg';
import { SidebarTagsSection } from '@property/tags/SidebarTagsSection';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import { pressHandlers } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { type Component, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { EMAIL_TAB_IDS, EMAIL_TABS, type EmailTabItem } from '../constants';
import { useEmailView } from '../email-view-context';
import { EMAIL_TOUR } from '../tour';
import type { EmailTab } from '../types';
import { EmailPrimaryActions } from './EmailHeader';
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
  const { state } = useEmailView();
  const reminders = useFeatureFlag(enableReminders);
  const items = (ids: EmailTab[]) =>
    ids.flatMap((id) => EMAIL_TABS.filter((tab) => tab.id === id));
  return (
    <div class="flex flex-col gap-5">
      <ViewSidebar.Nav aria-label="Mailboxes">
        <For each={items(['favorites', 'drafts', 'sent', 'scheduled'])}>
          {(item) => <Tab item={item} onNavigate={props.onNavigate} />}
        </For>
        <Show
          when={
            reminders().enabled ||
            (reminders().loading && state.tab === 'reminders')
          }
        >
          <Tab item={items(['reminders'])[0]} onNavigate={props.onNavigate} />
        </Show>
      </ViewSidebar.Nav>
      <section aria-label="Library" class="flex flex-col gap-2">
        <h2 class="px-(--sidebar-item-inset) text-xs font-medium text-ink-extra-muted">
          Library
        </h2>
        <ViewSidebar.Nav aria-label="Email library">
          <For each={items(['all', 'archived', 'shared', 'calendar'])}>
            {(item) => (
              <Tab
                item={item.id === 'all' ? { ...item, label: 'All mail' } : item}
                onNavigate={props.onNavigate}
              />
            )}
          </For>
        </ViewSidebar.Nav>
      </section>
    </div>
  );
}

export function EmailSidebar(props: { onSearchEscape?: () => void }) {
  const reminders = useFeatureFlag(enableReminders);
  const panel = useSplitPanelOrThrow();
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
    ids: () =>
      EMAIL_TAB_IDS.filter(
        (id) =>
          id !== 'reminders' ||
          reminders().enabled ||
          (reminders().loading && state.tab === 'reminders')
      ),
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
      <EmailPrimaryActions onSearchEscape={props.onSearchEscape} />
      <ViewSidebar.Content class="gap-5 pt-2">
        <EmailInboxList />

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
