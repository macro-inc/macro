import { PillTabs } from '@components/app/mobile/PillTabs';
import { TabsInset } from '@core/component/TabsInset';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import type { InboxViewState } from '../create-inbox-view-state';
import type { InboxTab } from '../types';
import { InboxFilterDrawer, InboxFilterDropdown } from './InboxFilters';

const INBOX_TABS: { value: InboxTab; label: string }[] = [
  { value: 'signal', label: 'Signal' },
  { value: 'noise', label: 'Noise' },
  { value: 'all', label: 'All' },
];

/** Compact category switcher from the Activity-layout Inbox experiment. */
export function InboxTabs(props: { state: InboxViewState }) {
  const setTab = (value: string) => {
    const tab = INBOX_TABS.find((item) => item.value === value);
    if (!tab) return;

    props.state.setTab(tab.value);
  };

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <div class="flex h-8 min-w-0 flex-1 items-center gap-3">
          <div class="h-8 min-w-0 basis-3/4 shrink max-w-72">
            <TabsInset
              aria-label="Inbox views"
              list={INBOX_TABS}
              value={props.state.tab()}
              onChange={setTab}
              class="h-8"
              trackClass="h-full"
              fullWidth
            />
          </div>
          <InboxFilterDropdown state={props.state} />
        </div>
      }
    >
      <div class="h-10 min-w-0 flex-1">
        <PillTabs
          scrollable
          leading={<InboxFilterDrawer state={props.state} />}
          items={INBOX_TABS}
          value={props.state.tab()}
          onChange={setTab}
        />
      </div>
    </Show>
  );
}
