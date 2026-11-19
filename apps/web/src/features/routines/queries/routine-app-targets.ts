import { useAgentsQuery } from '@queries/agents/agents';
import { queryReadyGate } from '@queries/gate';
import type { Accessor } from 'solid-js';
import {
  type RoutineTarget,
  routineHarnessSupportsApps,
} from '../core/routine-target';

export function createRoutineAppTargetCheck(
  enabled: Accessor<boolean>
): (target: RoutineTarget) => boolean {
  const agents = useAgentsQuery(enabled);
  return (target) => {
    if (target.kind === 'model') return true;
    const id = target.agentId.toLowerCase();
    const agent = queryReadyGate(agents)
      ? agents.data.find((agent) => agent.bot.id === id)
      : undefined;
    return !agent || routineHarnessSupportsApps(agent.harness);
  };
}
