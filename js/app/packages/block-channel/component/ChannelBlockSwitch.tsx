import { ShowFeatureFlag, useFeatureFlag } from '@app/lib/analytics/posthog';
import type { BlockChannelProps } from './Block';
import BlockChannel from './Block';
import { NewChannelBlockAdapter } from './NewChannelBlockAdapter';
import { Show } from 'solid-js';

export function ChannelBlockSwitch(props: BlockChannelProps) {
  const flag = useFeatureFlag('enable-new-channels');

  return (
    <ShowFeatureFlag
      key="enable-new-channels"
      fallback={<BlockChannel {...props} />}
    >
      <NewChannelBlockAdapter />
    </ShowFeatureFlag>
  );
}
