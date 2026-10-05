import { Tabs } from '@ui/components/Tabs';
import { useChannelTab } from './ChannelTabContext';
import type { ChannelTabId } from './channel-tabs';
import { useChannelTabItems } from './use-channel-tab-items';

/** Shared content navigation for split and inline channel surfaces. */
export function ChannelTabs(props: { channelId: string }) {
  const { activeTab, setActiveTab } = useChannelTab();
  const tabs = useChannelTabItems(props.channelId);

  return (
    <div class="min-w-0 shrink-0 overflow-x-auto scrollbar-hidden px-2 py-2">
      <Tabs
        aria-label="Channel views"
        class="w-max whitespace-nowrap"
        list={tabs().map((tab) => ({
          value: tab.value,
          label: () => tab.label,
        }))}
        value={activeTab()}
        onChange={(value) => setActiveTab(value as ChannelTabId)}
      />
    </div>
  );
}
