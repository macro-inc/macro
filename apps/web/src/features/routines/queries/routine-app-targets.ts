import { CODEX_BOT_ID } from '@core/constant/codexAgent';
import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import { useAgentsQuery } from '@queries/agents/agents';
import { queryReadyGate } from '@queries/gate';
import {
  type RoutineTarget,
  routineHarnessSupportsApps,
} from '../core/routine-target';

const MANAGED_SYSTEM_BOTS = new Set([
  // MACRO_NEW_BOT_ID, the scheduler's runtime for model-only steps.
  '00000000-0000-0000-0000-00000000a2a2',
  MACRO_CODER_BOT_ID,
  CURSOR_BOT_ID,
  CODEX_BOT_ID,
]);

export function createRoutineAppTargetCheck(): (
  target: RoutineTarget
) => boolean {
  const agents = useAgentsQuery();
  return (target) => {
    if (target.kind === 'model') return true;
    const id = target.agentId.toLowerCase();
    const agent = queryReadyGate(agents)
      ? agents.data.find((agent) => agent.bot.id === id)
      : undefined;
    return agent
      ? routineHarnessSupportsApps(agent.harness)
      : MANAGED_SYSTEM_BOTS.has(id);
  };
}
