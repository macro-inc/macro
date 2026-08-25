import type { AgentSessionLiveState } from '@queries/agent-session/live-list-state';
import type { AgentSessionEntity } from '../types/entity';

/**
 * Derived attention state of an agent session, ordered by how urgently the
 * row wants the user: a blocked session outranks a working one, which
 * outranks a finished deliverable, which outranks everything settled.
 */
export type AgentAttentionState =
  | 'needs_approval'
  | 'running'
  | 'pr_ready'
  | 'past';

/** Bucket order for the agents view grouping, most urgent first. */
export const AGENT_ATTENTION_ORDER: readonly AgentAttentionState[] = [
  'needs_approval',
  'running',
  'pr_ready',
  'past',
];

export const AGENT_ATTENTION_LABELS: Record<AgentAttentionState, string> = {
  needs_approval: 'Needs approval',
  running: 'Running',
  pr_ready: 'PR ready',
  past: 'Past',
};

/**
 * Whether the session's container is up. Live state (followed off the
 * session's log stream) wins over the entity's snapshot columns, which only
 * move on refetch. Absence of any status yet means the runtime is still
 * being provisioned — the most alive a session gets.
 */
const isAlive = (
  entity: AgentSessionEntity,
  live: AgentSessionLiveState | undefined
): boolean => {
  if (live) return live.statusEvent !== 'disconnected';
  if (entity.statusKind === 'disconnected') return false;
  return entity.statusEventName !== 'disconnected';
};

/**
 * The attention bucket a session row belongs to. Pure over its inputs; pass
 * the session's `agentSessionLiveState` where one is being followed so the
 * bucket moves with the stream instead of waiting on a refetch.
 *
 * An alive container is running unless the fold says its last turn finished
 * — snapshot columns cannot tell a working session from an idle one (both
 * sit at `acp_ready`), so without live state alive errs toward running.
 */
export const agentAttentionState = (
  entity: AgentSessionEntity,
  live?: AgentSessionLiveState
): AgentAttentionState => {
  if (!isAlive(entity, live)) return entity.prUrl ? 'pr_ready' : 'past';

  const pending = live
    ? live.pendingPermissionCount
    : entity.pendingPermissionCount;
  if (pending > 0) return 'needs_approval';

  // Idle with a PR out: the deliverable is what wants the user now.
  if (live && !live.working && entity.prUrl) return 'pr_ready';
  return 'running';
};

/** Grouping id the agents view preset selects (client-side bucketing). */
export const AGENT_ATTENTION_GROUP_ID = 'agent-attention';
