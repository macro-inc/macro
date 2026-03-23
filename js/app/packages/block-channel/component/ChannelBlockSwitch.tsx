import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
// import { ENABLE_NEW_CHANNELS } from '@core/constant/featureFlags';
import type { BlockChannelProps } from './Block';
import BlockChannel from './Block';
import { NewChannelBlockAdapter } from './NewChannelBlockAdapter';

export function ChannelBlockSwitch(props: BlockChannelProps) {
  return (
    <ShowFeatureFlag
      key="enable-new-channels"
      // enabledOverride={ENABLE_NEW_CHANNELS()}
      fallback={<BlockChannel {...props} />}
    >
      <NewChannelBlockAdapter />
    </ShowFeatureFlag>
  );
}
