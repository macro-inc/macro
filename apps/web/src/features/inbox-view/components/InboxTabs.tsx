import { TabsInset } from '@core/component/TabsInset';
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
    <div class="mx-4 mt-3 h-9 shrink-0 touch:mx-0">
      <TabsInset
        aria-label="Inbox views"
        list={INBOX_TABS}
        value={props.state.tab()}
        onChange={setTab}
        fullWidth
      />
    </div>
  );
}
