/**
 * Where each subject lives on the agent harness's `/agent-feedback` routes,
 * and the ids its spans carry. Client-built values only, so matches here are
 * closed.
 */
import { match } from 'ts-pattern';
import type { FeedbackContainer, FeedbackSubject } from './subject';

/** The container's route under `/agent-feedback`. */
export function containerPath(container: FeedbackContainer): string {
  return match(container)
    .with(
      { kind: 'agent_session' },
      (c) => `/agent-sessions/${encodeURIComponent(c.sessionId)}`
    )
    .with(
      { kind: 'message_parent' },
      (c) =>
        `/messages/${encodeURIComponent(c.parentType)}/${encodeURIComponent(c.parentId)}`
    )
    .with(
      { kind: 'routine' },
      (c) => `/routines/${encodeURIComponent(c.routineId)}`
    )
    .exhaustive();
}

/** The response's route under `/agent-feedback`. */
export function subjectPath(subject: FeedbackSubject): string {
  return match(subject)
    .with(
      { kind: 'agent_session_turn' },
      (s) =>
        `${containerPath({ kind: 'agent_session', sessionId: s.sessionId })}/turns/${s.turn}`
    )
    .with(
      { kind: 'message' },
      (s) =>
        `${containerPath({ kind: 'message_parent', parentType: s.parentType, parentId: s.parentId })}/items/${encodeURIComponent(s.messageId)}`
    )
    .with(
      { kind: 'routine_run' },
      (s) =>
        `${containerPath({ kind: 'routine', routineId: s.routineId })}/runs/${encodeURIComponent(s.runId)}`
    )
    .exhaustive();
}

/** The ids a span about this subject records, by attribute name. */
export function subjectAttributes(
  subject: FeedbackSubject
): Record<string, string | number> {
  return match(subject)
    .with({ kind: 'agent_session_turn' }, (s) => ({
      'agent.session.id': s.sessionId,
      'agent_feedback.turn': s.turn,
    }))
    .with({ kind: 'message' }, (s) => ({
      'message.parent_type': s.parentType,
      'message.parent_id': s.parentId,
      'message.id': s.messageId,
    }))
    .with({ kind: 'routine_run' }, (s) => ({
      'routine.id': s.routineId,
      'routine.run_id': s.runId,
    }))
    .exhaustive();
}
