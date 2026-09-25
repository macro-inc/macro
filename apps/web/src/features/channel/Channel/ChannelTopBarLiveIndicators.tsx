import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { useBlockId } from '@core/block';
import { LiveIndicators } from '@core/component/LiveIndicators';
import { ENABLE_LIVE_INDICATORS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useUserIndicators } from '@core/state/liveIndicators';
import { useChannelPresenceSubscription } from '@queries/channel/presence';
import { Show } from 'solid-js';

/** Live viewer avatars for a channel; hosts place it in their own chrome. */
export function ChannelLiveIndicators(props: { channelId: string }) {
  const userId = useUserId();
  const indicators = useUserIndicators(() => props.channelId);
  useChannelPresenceSubscription(() => props.channelId);

  return (
    <Show when={ENABLE_LIVE_INDICATORS}>
      <LiveIndicators userIds={indicators() ?? []} currentUserId={userId()} />
    </Show>
  );
}

export function ChannelTopBarLiveIndicators() {
  const channelId = useBlockId();

  return (
    <SplitHeaderRight>
      {/* Hidden on mobile/tablet: no floating-island treatment for live avatars yet. */}
      <div class="-order-1 touch:hidden">
        <ChannelLiveIndicators channelId={channelId} />
      </div>
    </SplitHeaderRight>
  );
}
