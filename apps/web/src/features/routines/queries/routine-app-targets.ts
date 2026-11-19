import { useAgentsQuery } from '@queries/agents/agents';
import { queryReadyGate } from '@queries/gate';
import {
  type RoutineTarget,
  routineHarnessSupportsApps,
} from '../core/routine-target';

export function createRoutineAppTargetCheck(): (
  target: RoutineTarget
) => boolean {
  const agents = useAgentsQuery();
  return (target) => {
    if (target.kind === 'model') return true;
    const id = target.agentId.toLowerCase();
    const agent =
      !agents.isError && queryReadyGate(agents)
        ? agents.data.find((agent) => agent.bot.id === id)
        : undefined;
    return !agent || routineHarnessSupportsApps(agent.harness);
  };
}
