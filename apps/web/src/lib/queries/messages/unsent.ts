import { deferredGate } from '@core/util/debounce';
import { useMutationState } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { channelCacheHost } from './local/channel-flag';

/** Identifies send-message mutations in the mutation cache. */
export const SEND_MESSAGE_MUTATION_KEY = ['messages', 'send'] as const;

/** How long a send may stay unanswered before its message is marked unsent. */
export const UNSENT_AFTER_MS = 5000;

/**
 * Whether this session has been trying to send the message for longer than
 * `UNSENT_AFTER_MS`: it is waiting for a connection or for its channel to
 * let it in. A send that is refused for good rolls back instead. Nothing is
 * marked, or watched, while channels send over REST
 * (`enable-channel-local-sync` off): every message row would otherwise follow
 * every mutation.
 */
export function useMessageUnsent(messageId: () => string): () => boolean {
  const local = createMemo(() => channelCacheHost() !== undefined);
  const sending = createMemo(() =>
    local() ? watchSend(messageId) : undefined
  );
  return deferredGate(() => (sending()?.().length ?? 0) > 0, UNSENT_AFTER_MS);
}

/** The pending sends of one message; call under the owner that keeps it. */
function watchSend(messageId: () => string) {
  return useMutationState(() => {
    const id = messageId();
    return {
      filters: {
        mutationKey: SEND_MESSAGE_MUTATION_KEY,
        status: 'pending' as const,
        predicate: (mutation) =>
          optimisticIdOf(mutation.state.variables) === id,
      },
      select: (mutation) => mutation.mutationId,
    };
  });
}

export function optimisticIdOf(variables: unknown): string | undefined {
  if (typeof variables !== 'object' || variables === null) return undefined;
  if (!('optimisticId' in variables)) return undefined;
  return typeof variables.optimisticId === 'string'
    ? variables.optimisticId
    : undefined;
}
