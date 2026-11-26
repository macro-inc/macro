// An agent teammate whose computer is offline, without the team queries.
import { AGENT } from './dm';

export * from '../../../settings/primitives/team-agent-status';

export function useTeamAgentStatus(userId: () => string | undefined) {
  const agent = () => (userId() === AGENT ? { userId: AGENT } : undefined);
  return {
    agent,
    state: () => (agent() ? ('offline' as const) : undefined),
  };
}
