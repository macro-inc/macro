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
 * Runtime events that mean the session is actively standing something up or
 * working. Deliberately conservative: `acp_ready` is a live-but-idle agent
 * awaiting input, and unknown event names are not claimed as running rather
 * than pinning stale sessions to the top of the list.
 */
const RUNNING_EVENTS = new Set(['booting', 'worktree_ready']);

const isRunning = (entity: AgentSessionEntity): boolean => {
  // A session with no status yet was just opened — its runtime is being
  // provisioned, which is the most "running" a session gets.
  if (entity.statusKind === 'no_messages') return true;
  if (entity.statusKind === 'disconnected') return false;
  return entity.statusEventName
    ? RUNNING_EVENTS.has(entity.statusEventName)
    : false;
};

/** The attention bucket a session row belongs to. Pure. */
export const agentAttentionState = (
  entity: AgentSessionEntity
): AgentAttentionState => {
  if (entity.pendingPermissionCount > 0) return 'needs_approval';
  if (isRunning(entity)) return 'running';
  if (entity.prUrl) return 'pr_ready';
  return 'past';
};

/** Grouping id the agents view preset selects (client-side bucketing). */
export const AGENT_ATTENTION_GROUP_ID = 'agent-attention';
