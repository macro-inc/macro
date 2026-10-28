import { useCall } from '@channel/Call/use-call';
import { isNativeCallEnabled } from '@channel/Call/use-callkit';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannel, useChannelType } from '@core/context/channels';
import { useActiveCallQuery } from '@queries/call/call';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { cn, type TabOption } from '@ui';
import type { Accessor } from 'solid-js';
import { useChannelTab } from './ChannelTabContext';
import {
  CHANNEL_TABS,
  type ChannelTabId,
  DEFAULT_CHANNEL_TAB,
} from './channel-tabs';

export const canUseInlineCallTab = () => {
  return !isNativeCallEnabled();
};

// Native iOS CallKit owns the call surface, so the embedded Call tab should
// never become the active channel tab on that platform.
export const normalizeChannelTab = (tab: ChannelTabId) => {
  return tab === 'call' && !canUseInlineCallTab() ? DEFAULT_CHANNEL_TAB : tab;
};

function LiveCallDot(props: { class?: string }) {
  return (
    <span class={cn('flex items-center justify-center', props.class)}>
      <span class="size-1.5 rounded-full bg-success animate-pulse" />
    </span>
  );
}

/** The live Call tab's label in menus that draw their own icon. */
export function CallTabLabel() {
  return (
    <span class="flex items-center gap-1.5">
      <LiveCallDot />
      Call
    </span>
  );
}

/**
 * The tabs a channel host should offer right now: DMs hide participants,
 * calls-disabled builds hide call history, and the live Call tab appears only
 * while relevant. Reads the active tab from the enclosing ChannelTabProvider.
 */
export function useChannelTabItems(
  channelId: string
): Accessor<TabOption<ChannelTabId>[]> {
  const { activeTab } = useChannelTab();
  const channelType = useChannelType(channelId);
  const channel = useChannel(channelId);
  const call = useCall(() => channelId);
  const activeCallQuery = useActiveCallQuery(() => channelId);
  // Show the Call tab whenever we're actually in the call, mid-join, or
  // the tab is being displayed (e.g. via the auto-join flow that flips
  // `activeTab` to `call` before the join request resolves).
  const showCallTab = () =>
    ENABLE_CALLS &&
    !channel()?.agent_dm &&
    canUseInlineCallTab() &&
    (call.isInThisChannel() ||
      call.isJoining() ||
      activeTab() === 'call' ||
      !!activeCallQuery.data);
  const availableTabs = () => {
    let filtered = [...CHANNEL_TABS];
    if (channelType() === ChannelType.direct_message)
      filtered = filtered.filter((tab) => tab.value !== 'participants');
    if (!ENABLE_CALLS || channel()?.agent_dm)
      filtered = filtered.filter((tab) => tab.value !== 'calls');
    if (!showCallTab())
      filtered = filtered.filter((tab) => tab.value !== 'call');
    return filtered;
  };

  return () =>
    availableTabs().map((tab) =>
      tab.value === 'call' ? { ...tab, icon: LiveCallDot } : { ...tab }
    );
}
