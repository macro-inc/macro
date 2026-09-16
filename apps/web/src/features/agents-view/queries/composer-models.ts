import {
  type AgentModelTarget,
  useAgentModelsQueries,
} from '@queries/agents/models';
import type { Accessor } from 'solid-js';
import type { RosterAgent } from '../core/roster';

/** Map a roster entry to the same discovery target used by agent settings. */
export function composerModelTarget(
  agent: Pick<RosterAgent, 'harness' | 'harnessId'> | undefined
): AgentModelTarget | undefined {
  if (!agent) return;
  if (agent.harness === 'in-memory' || agent.harness === 'macro-inmem') {
    return { harness: 'in-memory' };
  }
  if (agent.harness === 'cursor') return { harness: 'cursor' };
  if (agent.harness === 'macrod' && agent.harnessId) {
    return { harness: 'macrod', harnessId: agent.harnessId };
  }
}

/** Keep discovery scoped to the selected, connected runtime. */
export function createComposerModels(agent: Accessor<RosterAgent | undefined>) {
  const queries = useAgentModelsQueries(() => {
    const selected = agent();
    const target = composerModelTarget(selected);
    return target && selected?.runtime.connected ? [target] : [];
  });
  // Status-gated reads keep a pending catalog from suspending the composer.
  const data = () => (queries[0]?.isSuccess ? queries[0].data : undefined);
  return {
    models: () => data()?.models ?? [],
    currentModel: () => data()?.currentModel ?? undefined,
    message: () => {
      if (!agent()?.runtime.connected)
        return 'Connect the runtime to load models.';
      if (queries[0]?.isError)
        return 'Could not load models from this runtime.';
      if (queries[0]?.isPending) return 'Loading models…';
      if (data()?.status === 'unsupported' || !composerModelTarget(agent())) {
        return 'This runtime does not provide model discovery.';
      }
      return 'This runtime returned no models.';
    },
  };
}
