import { ShowFeatureFlag, useFeatureFlag } from '@app/lib/analytics/posthog';
import type { BlockChannelProps } from './Block';
import BlockChannel from './Block';
import { NewChannelBlockAdapter } from './NewChannelBlockAdapter';
import { Match, Switch } from 'solid-js';

export function ChannelBlockSwitch(props: BlockChannelProps) {
  const ff = useFeatureFlag('enable-new-channels');
  return (
    <Switch>
      <Match when={ff().enabled}>
        <NewChannelBlockAdapter />
      </Match>
      <Match when={true}>
        <BlockChannel {...props} />
      </Match>
    </Switch>
  );
}
