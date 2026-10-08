import {
  type AgentModelTarget,
  useAgentModelsQuery,
} from '@queries/agents/models';
import { ModelHarnessDto } from '@service-agent-harness/generated/schemas/modelHarnessDto';
import type { Accessor } from 'solid-js';
import type { RosterAgent } from '../core/roster';

/**
 * Disabled-query placeholder. `useQuery` still wants a target for its key;
 * this one is never fetched and does not collide with a live catalog.
 */
const IDLE_MODEL_TARGET: AgentModelTarget = {
  harness: 'in-memory',
  harnessId: 'composer-idle',
};

/** Map a roster entry to the same discovery target used by agent settings. */
export function composerModelTarget(
  agent: Pick<RosterAgent, 'harness' | 'harnessId'> | undefined
): AgentModelTarget | undefined {
  if (!agent) return;
  const requested =
    agent.harness === 'macro-inmem' ? 'in-memory' : agent.harness;
  const harness = Object.values(ModelHarnessDto).find(
    (value) => value === requested
  );
  if (!harness) return;
  if (harness === 'macrod') {
    return agent.harnessId
      ? { harness, harnessId: agent.harnessId }
      : undefined;
  }
  return { harness };
}

/** Keep discovery scoped to the selected, connected runtime. */
export function createComposerModels(agent: Accessor<RosterAgent | undefined>) {
  const target = (): AgentModelTarget | undefined => {
    const selected = agent();
    const next = composerModelTarget(selected);
    return next && selected?.runtime.connected ? next : undefined;
  };
  // `useQueries` exposes `data` as a Solid resource, so reading it suspends
  // on every update — including after success. The composer lives under
  // <Suspense>; that suspend detaches the editor and closes an open mention
  // menu. `useQuery` only suspends while `data` is still undefined, and the
  // isSuccess gate below skips that read.
  const query = useAgentModelsQuery(
    () => target() ?? IDLE_MODEL_TARGET,
    () => target() !== undefined
  );
  const data = () => (target() && query.isSuccess ? query.data : undefined);
  return {
    models: () => data()?.models ?? [],
    currentModel: () => data()?.currentModel ?? undefined,
    /** Discovery is in flight, so {@link models} is empty for now, not for good. */
    pending: () => target() !== undefined && query.isPending,
    message: () => {
      if (!agent()?.runtime.connected)
        return 'Connect the runtime to load models.';
      if (!target()) return 'This runtime does not provide model discovery.';
      if (query.isError) return 'Could not load models from this runtime.';
      if (query.isPending) return 'Loading models…';
      if (data()?.status === 'unsupported') {
        return 'This runtime does not provide model discovery.';
      }
      return 'This runtime returned no models.';
    },
  };
}
