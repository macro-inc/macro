import { type RosterAgent, rosterForAgentPicker } from './roster';

/** Keep ready-to-use choices ahead of agents that need setup. */
export function agentPickerGroups(roster: readonly RosterAgent[]) {
  const agents = rosterForAgentPicker(roster);
  return [
    {
      label: 'Built-in',
      agents: agents.filter(
        (agent) => !agent.unavailableReason && agent.share === 'system'
      ),
    },
    {
      // A powered-off computer's agent is still one of yours, just off.
      label: 'Your agents',
      agents: agents.filter(
        (agent) =>
          (!agent.unavailableReason || agent.poweredOff) &&
          agent.share !== 'system'
      ),
    },
    {
      label: 'Needs connection',
      agents: agents.filter(
        (agent) => agent.unavailableReason && !agent.poweredOff
      ),
    },
  ].filter((group) => group.agents.length > 0);
}
