import type { Harness } from '@service-storage/client';

/**
 * An agent teammate's computer. The agent is a member people message, so its
 * runtime is never offered for starting an agent or binding one to it.
 */
export function isTeamAgentComputer(
  harness: Pick<Harness, 'team_agent_user_id'>
): boolean {
  return !!harness.team_agent_user_id;
}

/** The runtimes agents may be started on or bound to. */
export function runnableHarnesses(harnesses: readonly Harness[]): Harness[] {
  return harnesses.filter((harness) => !isTeamAgentComputer(harness));
}
