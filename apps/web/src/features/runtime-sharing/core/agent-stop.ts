import { useUserId } from '@core/context/user';
import { useAgentsQuery } from '@queries/agents/agents';
import { useHarnessDirectoryQuery } from '@queries/harnesses/harnesses';
import { type Accessor, createMemo } from 'solid-js';

/** A resident that cannot run because its owner lost access to its runtime. */
export type AgentStop = {
  harnessId: string;
  runtimeName: string;
  /** The viewer owns the agent, so asking for the runtime would restart it. */
  viewerOwnsAgent: boolean;
};

/**
 * Why the agent behind `botId` is stopped, or `undefined` while it can run or
 * nothing about it has loaded. Only agents the viewer can manage say.
 */
export function useAgentStop(
  botId: Accessor<string | undefined>
): Accessor<AgentStop | undefined> {
  const agents = useAgentsQuery();
  const directory = useHarnessDirectoryQuery();
  const userId = useUserId();
  return createMemo(() => {
    const id = botId();
    if (!id || !agents.isSuccess || !directory.isSuccess) return;
    const agent = agents.data.find((candidate) => candidate.bot.id === id);
    if (agent?.stopped_reason !== 'no_runtime_access' || !agent.harness_id)
      return;
    const harnessId = agent.harness_id;
    const runtime = directory.data.find((harness) => harness.id === harnessId);
    if (!runtime) return;
    const owner = agent.bot.owner;
    return {
      harnessId,
      runtimeName: runtime.name,
      viewerOwnsAgent: owner?.type === 'user' && owner.user_id === userId(),
    };
  });
}
