import { cn } from '@ui';
import { Tabs } from '@ui/components/Tabs';
import type { JSX, ParentProps } from 'solid-js';
import { useChannelTab } from './ChannelTabContext';
import type { ChannelTabId } from './channel-tabs';
import { useChannelTabItems } from './use-channel-tab-items';

type ChannelTabLayoutProps = ParentProps<{
  class?: string;
  tabs: JSX.Element;
}>;

/**
 * Gives channel chrome its intrinsic height and measures the active tab pane
 * against the space left over. Keep every host on this layout boundary: a
 * pane with `h-full` must fill the remainder, not the pre-chrome container.
 */
export function ChannelTabLayout(props: ChannelTabLayoutProps) {
  return (
    <div class={cn('flex min-h-0 flex-col', props.class)}>
      {props.tabs}
      <div class="flex min-h-0 flex-1 flex-col" data-channel-tab-content>
        {props.children}
      </div>
    </div>
  );
}

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
