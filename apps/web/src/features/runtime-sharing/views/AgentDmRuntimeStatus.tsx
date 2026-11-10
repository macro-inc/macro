import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { Show } from 'solid-js';
import { useAgentStop } from '../core/agent-stop';
import { AgentStoppedStatus } from './AgentStoppedStatus';

/** An agent DM's header says when its agent has stopped, and why. */
export function AgentDmRuntimeStatus(props: { botId: string | undefined }) {
  const stop = useAgentStop(() => props.botId);
  return (
    <Show when={stop()}>
      {(current) => (
        <SplitHeaderRight>
          <HeaderIsland class="min-w-0 max-w-full px-2">
            <AgentStoppedStatus stop={current()} />
          </HeaderIsland>
        </SplitHeaderRight>
      )}
    </Show>
  );
}
