import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import type { BlockChannelProps } from './Block';
import BlockChannel from './Block';
import { NewChannelBlockAdapter } from './NewChannelBlockAdapter';

export function ChannelBlockSwitch(props: BlockChannelProps) {
  return (
    <ShowFeatureFlag
      key="enable-new-channels"
      fallback={<BlockChannel {...props} />}
    >
      <NewChannelBlockAdapter />
    </ShowFeatureFlag>
  );
}
