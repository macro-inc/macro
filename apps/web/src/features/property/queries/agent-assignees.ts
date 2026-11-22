import { useAgentMentionUsers } from '@channel/use-agent-mention-users';
import { useOwnAgentMentionUsers } from '@channel/use-own-agent-mention-users';
import { isMacroAgentId } from '@core/constant/macroAgent';
import type { IUser } from '@core/user';
import type { Accessor } from 'solid-js';

/** Agents use their canonical bot principal in the USER assignee property. */
export function useAgentAssignees(
  enabled: Accessor<boolean>
): Accessor<IUser[]> {
  const savedAgents = useOwnAgentMentionUsers(enabled);
  // Reuse the message composer's system-agent roster and rollout policy.
  // Classic Macro replies inline without a session, so it cannot be assigned.
  const available = useAgentMentionUsers(savedAgents, enabled);
  return () => available().filter((agent) => !isMacroAgentId(agent.id));
}
