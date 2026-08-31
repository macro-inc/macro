import { PillTabs } from '@components/app/mobile/PillTabs';
import { TabsInset } from '@core/component/TabsInset';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import type { InboxViewState } from '../create-inbox-view-state';
import type { InboxTab } from '../types';

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
        <div class="h-9 min-w-0 flex-1">
          <TabsInset
            aria-label="Inbox views"
            list={INBOX_TABS}
            value={props.state.tab()}
            onChange={setTab}
            fullWidth
          />
        </div>
      }
    >
      <div class="h-10 min-w-0 flex-1">
        <PillTabs
          scrollable
          items={INBOX_TABS}
          value={props.state.tab()}
          onChange={setTab}
        />
      </div>
    </Show>
  );
}
