/**
 * The person's ratings per container, and the writes that change them. A
 * write patches the container's cached ratings at once and puts back only its
 * own response's rating if the server refuses it, so writes to other
 * responses in the same container are never undone with it.
 */

import {
  type ResultError,
  thrownResultErrorHasCode,
  throwOnErr,
} from '@core/util/result';
import { queryReadyGate } from '@queries/gate';
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import type {
  FeedbackFailure,
  FeedbackWrite,
  ResponseFeedbackSource,
} from '../context/response-feedback-context';
import {
  containerKey,
  type FeedbackContainer,
  type FeedbackState,
  type FeedbackSubject,
  type FeedbackSurface,
  feedbackContainer,
  type MyFeedbackItem,
  responseKey,
} from '../core/subject';
import type { AgentFeedbackClient } from './client';
import { agentFeedbackKeys } from './keys';

type WriteVariables = {
  id: string;
  subject: FeedbackSubject;
  surface: FeedbackSurface;
  write: FeedbackWrite;
};

/** The response's rating before the write, to put back if it fails. */
type WriteContext = { previous: MyFeedbackItem | undefined };

function refusesFeedback(errors: ResultError<string>[]): boolean {
  return errors.some(
    (error) => error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'
  );
}

function mineKey(container: FeedbackContainer) {
  return agentFeedbackKeys.mine(containerKey(container)).queryKey;
}

/**
 * The container's ratings, or null when the person can't rate there: the
 * server's flag is off for them (404) or they lost view access (403). Null is
 * data, so a long transcript doesn't refetch a refusal per mounted reply.
 */
export function myFeedbackQueryOptions(
  client: AgentFeedbackClient,
  container: FeedbackContainer
) {
  return queryOptions({
    queryKey: mineKey(container),
    queryFn: async (): Promise<MyFeedbackItem[] | null> => {
      const result = await client.mine(container);
      if (result.isErr() && refusesFeedback(result.error)) return null;
      return throwOnErr(async () => result);
    },
  });
}

/** Replaces (or, with `item` undefined, removes) one response's rating. */
function setItem(
  queryClient: QueryClient,
  subject: FeedbackSubject,
  item: MyFeedbackItem | undefined
) {
  const key = responseKey(subject);
  queryClient.setQueryData<MyFeedbackItem[] | null>(
    mineKey(feedbackContainer(subject)),
    (items) => {
      if (!items) return items;
      const others = items.filter((existing) => existing.key !== key);
      return item ? [...others, item] : others;
    }
  );
}

function currentItem(queryClient: QueryClient, subject: FeedbackSubject) {
  const key = responseKey(subject);
  return queryClient
    .getQueryData<MyFeedbackItem[] | null>(mineKey(feedbackContainer(subject)))
    ?.find((item) => item.key === key);
}

export function feedbackWriteMutationOptions(
  queryClient: QueryClient,
  client: AgentFeedbackClient
) {
  return {
    mutationFn: async ({ id, subject, surface, write }: WriteVariables) => {
      if (write.kind === 'retract') {
        await throwOnErr(() => client.retract(subject, { id, surface }));
        return undefined;
      }
      return throwOnErr(() =>
        client.rate(subject, {
          id,
          rating: write.rating,
          note: write.note,
          surface,
        })
      );
    },

    onMutate: async ({
      subject,
      write,
    }: WriteVariables): Promise<WriteContext> => {
      // A read already in flight must not land over this write.
      await queryClient.cancelQueries({
        queryKey: mineKey(feedbackContainer(subject)),
      });
      const previous = currentItem(queryClient, subject);
      const optimistic =
        write.kind === 'rate'
          ? {
              key: responseKey(subject),
              rating: write.rating,
              note: write.note,
              updatedAt: new Date().toISOString(),
            }
          : undefined;
      setItem(queryClient, subject, optimistic);
      return { previous };
    },

    onError: (
      _error: unknown,
      { subject }: WriteVariables,
      context: WriteContext | undefined
    ) => {
      if (context) setItem(queryClient, subject, context.previous);
    },

    onSuccess: (
      state: FeedbackState | undefined,
      { subject }: WriteVariables
    ) => {
      // The server's answer is the current state, including when it found
      // the write already applied.
      setItem(
        queryClient,
        subject,
        state ? { ...state, key: responseKey(subject) } : undefined
      );
    },
  };
}

function toFailure(error: unknown): FeedbackFailure {
  if (thrownResultErrorHasCode(error, 'NOT_FOUND')) return 'unavailable';
  if (thrownResultErrorHasCode(error, 'FORBIDDEN')) return 'forbidden';
  return 'failed';
}

/**
 * One response's rating, served from its container's read. Call under the
 * consuming owner: the read and the write observer live as long as it does.
 */
export function createResponseFeedbackSource(
  client: AgentFeedbackClient,
  subject: FeedbackSubject,
  surface: FeedbackSurface
): ResponseFeedbackSource {
  const queryClient = useQueryClient();
  const container = feedbackContainer(subject);
  const key = responseKey(subject);
  const query = useQuery(() => myFeedbackQueryOptions(client, container));
  const mutation = useMutation(() =>
    feedbackWriteMutationOptions(queryClient, client)
  );

  return {
    ready: () => queryReadyGate(query) && query.data !== null,
    current: () => {
      if (!queryReadyGate(query)) return undefined;
      return query.data?.find((item) => item.key === key);
    },
    async write(id, write) {
      const result = await ResultAsync.fromPromise(
        mutation.mutateAsync({ id, subject, surface, write }),
        toFailure
      );
      return result.map(() => undefined);
    },
  };
}
