import { createStore } from 'solid-js/store';
import { match } from 'ts-pattern';
import {
  DEFAULT_ANSWERERS,
  type InteractionController,
  type InteractionDraft,
  type InteractionIdentity,
  type InteractionResponse,
  type InteractionSource,
} from '../context/interaction';

/**
 * A request's identity within its session. The fold sends a new object for
 * the same request on every event, so a surface listing requests keys them
 * by this, not by the object.
 */
export function interactionKey(request: InteractionIdentity): string {
  return JSON.stringify([request.turn, request.kind, request.requestId]);
}

/** Answers live requests through the session's existing optimistic path. */
export function createInteractionController(
  source: InteractionSource
): InteractionController {
  // The fold runs in a worker. Guard the gap before its optimistic update
  // reaches every surface, while leaving the request's outcome in the fold.
  const [answering, setAnswering] = createStore<
    Record<string, true | undefined>
  >({});
  // Unsent answers live as long as the surface that made this controller,
  // which outlasts the cards it shows: a card remounts, the answer stays.
  const drafts = new Map<string, InteractionDraft>();
  const key = (request: InteractionIdentity) =>
    JSON.stringify([source.sessionId(), interactionKey(request)]);
  const canAnswer = () => source.canEdit() === true;

  const respond = async (response: InteractionResponse): Promise<boolean> => {
    const identity = key(response);
    const live = source
      .pending()
      .some(
        (request) =>
          request.kind !== 'tool_approval' &&
          request.kind === response.kind &&
          request.turn === response.turn &&
          request.requestId === response.requestId
      );
    if (!source.sessionId() || !canAnswer() || !live || answering[identity])
      return false;

    const action = match(response)
      .with({ kind: 'permission' }, ({ requestId, answer }) => ({
        type: 'respondToPermission' as const,
        requestId,
        answer,
      }))
      .with({ kind: 'elicitation' }, ({ requestId, answer }) => ({
        type: 'respondElicitation' as const,
        requestId,
        ...answer,
      }))
      .exhaustive();

    setAnswering(identity, true);
    try {
      const result = await source.issue(action);
      if (!result) return false;
      if (result.isErr()) {
        source.onFailure(
          result.error.some((error) => error.code === 'CONFLICT')
            ? 'The agent is no longer waiting on that request'
            : "Couldn't send your answer"
        );
        return false;
      }
      drafts.delete(identity);
      return true;
    } catch {
      source.onFailure("Couldn't send your answer");
      return false;
    } finally {
      setAnswering(identity, undefined);
    }
  };

  return {
    pending: source.pending,
    canAnswer,
    answerers: source.answerers ?? DEFAULT_ANSWERERS,
    owns: () => source.owns?.() === true,
    answering: (request) => answering[key(request)] === true,
    respond,
    draft: (request) => drafts.get(key(request)),
    keepDraft: (request, draft) => {
      const identity = key(request);
      drafts.set(identity, { ...drafts.get(identity), ...draft });
    },
  };
}
