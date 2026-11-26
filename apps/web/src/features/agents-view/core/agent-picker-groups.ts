import { type RosterAgent, rosterForAgentPicker } from './roster';

/** Keep ready-to-use choices ahead of agents that need setup. */
export function agentPickerGroups(roster: readonly RosterAgent[]) {
  const agents = rosterForAgentPicker(roster);
  return [
    {
      id: 'builtin' as const,
      label: 'Built-in',
      agents: agents.filter(
        (agent) => !agent.unavailableReason && agent.share === 'system'
      ),
    },
    {
      id: 'personal' as const,
      // A powered-off computer's agent is still one of yours, just off.
      label: 'Your agents',
      agents: agents.filter(
        (agent) =>
          (!agent.unavailableReason || agent.poweredOff) &&
          agent.share !== 'system'
      ),
    },
    {
      id: 'connection' as const,
      label: 'Needs connection',
      agents: agents.filter(
        (agent) => agent.unavailableReason && !agent.poweredOff
      ),
    },
  ].filter((group) => group.agents.length > 0);
}
