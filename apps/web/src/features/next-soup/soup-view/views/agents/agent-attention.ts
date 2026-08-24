import type { AgentSessionEntity } from '@entity';

/**
 * The derived attention bucket an agent session row sits in, most urgent
 * first. Drives the Agents view's client-side grouping: sessions waiting on a
 * person float to the top, live work next, finished-with-a-PR after, and
 * everything past at the bottom.
 */
export type AgentAttentionState =
  | 'needs_approval'
  | 'running'
  | 'pr_ready'
  | 'past';

/** Bucket order, top of the list first. */
export const AGENT_ATTENTION_ORDER: AgentAttentionState[] = [
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
 * Runtime event names that mean the session is no longer doing anything.
 * The event vocabulary is open (harnesses emit their own names), so this is
 * deliberately a small denylist: an unknown event conservatively counts as
 * running rather than quietly burying a live session under Past.
 */
const INACTIVE_EVENTS = new Set(['disconnected', 'shutting_down']);

/** Whether the session's status says it is (or is becoming) live. */
export function isAgentSessionRunning(
  session: Pick<AgentSessionEntity, 'statusKind' | 'statusEventName'>
): boolean {
  if (session.statusKind === 'disconnected') return false;
  // No status yet: the session was just opened and its runtime is booting.
  if (session.statusKind === 'no_messages') return true;
  return !INACTIVE_EVENTS.has(session.statusEventName ?? '');
}

/** Derive the attention bucket for one session row. Pure. */
export function agentAttentionState(
  session: Pick<
    AgentSessionEntity,
    'pendingPermissionCount' | 'statusKind' | 'statusEventName' | 'prUrl'
  >
): AgentAttentionState {
  if (session.pendingPermissionCount > 0) return 'needs_approval';
  if (isAgentSessionRunning(session)) return 'running';
  if (session.prUrl) return 'pr_ready';
  return 'past';
}
