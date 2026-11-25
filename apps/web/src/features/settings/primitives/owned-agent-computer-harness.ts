import { useMacroComputersRollout } from '@queries/computers/computers';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type { TeamAgent } from '@service-auth/team-agents';
import type { Accessor } from 'solid-js';
import { agentComputerHarness } from '../core/team-agent-claude';

/** The viewer's runtime for the agent, when computers are available. */
export function useOwnedAgentComputerHarness(
  computerId: Accessor<TeamAgent['computerId']>
) {
  const computers = useMacroComputersRollout();
  const harnesses = useHarnessesQuery();
  return () => {
    if (!computers().enabled) return undefined;
    const harness = agentComputerHarness(
      computerId(),
      harnesses.isSuccess ? harnesses.data : undefined
    );
    return harness?.access === 'owner' ? harness : undefined;
  };
}
