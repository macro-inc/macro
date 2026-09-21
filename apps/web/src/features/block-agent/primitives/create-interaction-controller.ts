import { createStore } from 'solid-js/store';
import { match } from 'ts-pattern';
import type {
  InteractionController,
  InteractionIdentity,
  InteractionResponse,
  InteractionSource,
} from '../context/interaction';

/** Answers live requests through the session's existing optimistic path. */
export function createInteractionController(
  source: InteractionSource
): InteractionController {
  // The fold runs in a worker. Guard the gap before its optimistic update
  // reaches every surface, while leaving the request's outcome in the fold.
  const [answering, setAnswering] = createStore<
    Record<string, true | undefined>
  >({});
  const key = (request: InteractionIdentity) =>
    JSON.stringify([
      source.sessionId(),
      request.turn,
      request.kind,
      request.requestId,
    ]);
  const canAnswer = () => source.canEdit() === true;

  const respond = async (response: InteractionResponse): Promise<boolean> => {
    const identity = key(response);
    const live = source
      .pending()
      .some(
        (request) =>
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
    answering: (request) => answering[key(request)] === true,
    respond,
  };
}
