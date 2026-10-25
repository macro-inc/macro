import { modelLabel } from '@core/component/AI/constant/model-label';
import { createAgentRosterSource } from '../../agents-view/queries/agent-roster-source';
import type { RoutineTarget } from '../core/routine-target';

/** How a routine list names each routine's agent or model. */
export function createRoutineTargetDisplay() {
  const roster = createAgentRosterSource();
  const agent = (agentId: string) =>
    roster.roster().find((candidate) => candidate.botId === agentId);
  return {
    targetLabel: (target: RoutineTarget) =>
      target.kind === 'agent'
        ? (agent(target.agentId)?.name ?? 'Agent')
        : modelLabel(target.model),
    targetModel: (target: RoutineTarget) =>
      target.kind === 'agent'
        ? (target.modelOverride ?? agent(target.agentId)?.defaultModel)
        : target.model,
  };
}
