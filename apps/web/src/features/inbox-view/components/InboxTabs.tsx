import { useViewTabHotkeys } from '@app/components/view-shell';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Tabs } from '@ui';
import { Show } from 'solid-js';
import { useInboxView } from '../inbox-view-context';
import type { InboxTab } from '../types';
import { InboxFilterDrawer, InboxFilterDropdown } from './InboxFilters';

const INBOX_TABS: { value: InboxTab; label: string }[] = [
  { value: 'signal', label: 'Signal' },
  { value: 'noise', label: 'Noise' },
  { value: 'all', label: 'All' },
];
const INBOX_TAB_IDS = INBOX_TABS.map((tab) => tab.value);

/** Compact category switcher from the Activity-layout Inbox experiment. */
export function InboxTabs() {
  const panel = useSplitPanelOrThrow();
  const { state, setTab } = useInboxView();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => INBOX_TAB_IDS,
    activeId: () => state.tab,
    setActiveId: setTab,
  });

  const handleTabChange = (value: string) => {
    const tab = INBOX_TABS.find((item) => item.value === value);
    if (!tab) return;

    setTab(tab.value);
  };

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <div class="flex h-8 min-w-0 flex-1 items-center gap-3">
          <Tabs
            aria-label="Inbox views"
            list={INBOX_TABS}
            value={state.tab}
            onChange={handleTabChange}
          />
          <InboxFilterDropdown />
        </div>
      }
    >
      <div class="h-10 min-w-0 flex-1">
        <PillTabs
          scrollable
          leading={<InboxFilterDrawer />}
          items={INBOX_TABS}
          value={state.tab}
          onChange={handleTabChange}
        />
      </div>
    </Show>
  );
}
