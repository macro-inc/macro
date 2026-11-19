import {
  MACRO_PERSONA_ID,
  type RosterAgent,
} from '@app/features/agents-view/core/roster';

/** The choice that picks a chat or coding agent per prompt, as the new chat composer's Auto does. */
export const AUTO_AGENT_CHOICE = 'auto';

/** Agents a prompt block can run with: those that can start now, chat agents before coders. */
export function runnableAgents(roster: readonly RosterAgent[]): RosterAgent[] {
  const runnable = roster.filter((agent) => !agent.unavailableReason);
  return [
    ...runnable.filter((agent) => agent.kind === 'agent'),
    ...runnable.filter((agent) => agent.kind === 'coder'),
  ];
}

/** The coder Auto sends a coding prompt to: the most recently used, else the first that can start. */
export function autoCoder(
  agents: readonly RosterAgent[],
  recentAgentIds: readonly string[]
): RosterAgent | undefined {
  const coders = agents.filter((agent) => agent.kind === 'coder');
  for (const id of recentAgentIds) {
    const recent = coders.find((agent) => agent.id === id);
    if (recent) return recent;
  }
  return coders[0];
}

export function macroAgent(
  agents: readonly RosterAgent[]
): RosterAgent | undefined {
  return agents.find((agent) => agent.id === MACRO_PERSONA_ID);
}
