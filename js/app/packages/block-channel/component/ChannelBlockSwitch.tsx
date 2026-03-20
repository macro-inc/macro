import { ShowFeatureFlag, useFeatureFlag } from '@app/lib/analytics/posthog';
import type { BlockChannelProps } from './Block';
import BlockChannel from './Block';
import { NewChannelBlockAdapter } from './NewChannelBlockAdapter';
import { Show } from 'solid-js';

export function ChannelBlockSwitch(props: BlockChannelProps) {
  const flag = useFeatureFlag('enable-new-channels');

  return (
    <Show when={flag().enabled} fallback={<BlockChannel {...props} />}>
      <NewChannelBlockAdapter />
    </Show>
  );
}
