/**
 * What an agent response feedback rating is about: one agent response,
 * addressed by what it is, and the container whose `mine` read serves every
 * response rendered in it.
 */
import { match } from 'ts-pattern';

export type FeedbackRating = 'up' | 'down';

/** Where the person rated from; only the client knows it. */
export type FeedbackSurface =
  | 'agent_block'
  | 'agents_view'
  | 'message_timeline'
  | 'message_thread'
  | 'routine_run'
  | 'suggestion_row'
  | 'suggestion_tile'
  | 'suggestion_draft';

export type FeedbackSubject =
  | { kind: 'agent_session_turn'; sessionId: string; turn: number }
  | {
      kind: 'message';
      parentType: string;
      parentId: string;
      messageId: string;
    }
  | { kind: 'routine_run'; routineId: string; runId: string }
  | { kind: 'suggestion'; suggestionId: string };

/**
 * One `mine` read covers every response in a container. A suggestion is its
 * own container: the client batches the suggestions read together into one
 * request.
 */
export type FeedbackContainer =
  | { kind: 'agent_session'; sessionId: string }
  | { kind: 'message_parent'; parentType: string; parentId: string }
  | { kind: 'routine'; routineId: string }
  | { kind: 'suggestion'; suggestionId: string };

/** The person's current rating of one response. */
export type FeedbackState = {
  rating: FeedbackRating;
  note: string | null;
  updatedAt: string;
};

/** A current rating within a container, keyed by `responseKey`. */
export type MyFeedbackItem = FeedbackState & { key: string };

/** The longest note the server accepts. */
export const FEEDBACK_NOTE_MAX_LENGTH = 4000;

export function feedbackContainer(subject: FeedbackSubject): FeedbackContainer {
  return match(subject)
    .with({ kind: 'agent_session_turn' }, (s) => ({
      kind: 'agent_session' as const,
      sessionId: s.sessionId,
    }))
    .with({ kind: 'message' }, (s) => ({
      kind: 'message_parent' as const,
      parentType: s.parentType,
      parentId: s.parentId,
    }))
    .with({ kind: 'routine_run' }, (s) => ({
      kind: 'routine' as const,
      routineId: s.routineId,
    }))
    .with({ kind: 'suggestion' }, (s) => ({
      kind: 'suggestion' as const,
      suggestionId: s.suggestionId,
    }))
    .exhaustive();
}

/** A stable string for a container, for query keys. */
export function containerKey(container: FeedbackContainer): string {
  return match(container)
    .with({ kind: 'agent_session' }, (c) => `agent_session:${c.sessionId}`)
    .with(
      { kind: 'message_parent' },
      (c) => `message_parent:${c.parentType}:${c.parentId}`
    )
    .with({ kind: 'routine' }, (c) => `routine:${c.routineId}`)
    .with({ kind: 'suggestion' }, (c) => `suggestion:${c.suggestionId}`)
    .exhaustive();
}

/** The response's key within its container. */
export function responseKey(subject: FeedbackSubject): string {
  return match(subject)
    .with({ kind: 'agent_session_turn' }, (s) => String(s.turn))
    .with({ kind: 'message' }, (s) => s.messageId)
    .with({ kind: 'routine_run' }, (s) => s.runId)
    .with({ kind: 'suggestion' }, (s) => s.suggestionId)
    .exhaustive();
}

/** The trimmed note, or null when it says nothing. */
export function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
