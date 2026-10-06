import { throwOnErr } from '@core/util/result';
import { subscribeAgentSessionUpdated } from '@queries/agent-session/session-metadata-sync';
import { queryReadyGate } from '@queries/gate';
import type { Comment } from '@service-agent-harness/generated/schemas';
import { agentReviewClient } from '@service-agent-harness/reviews';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { type Accessor, onCleanup } from 'solid-js';
import { hiddenFiles, reviewFileGroups } from '../core/file-groups';
import type { ReviewFile } from '../core/model';
import type { ReviewData, ReviewSource } from '../core/source';

export const reviewKey = (session: string) =>
  ['agent-review', session] as const;
const fileOptions = (session: string, revision: number, path: string) =>
  queryOptions({
    queryKey: [...reviewKey(session), 'file', revision, path] as const,
    queryFn: async ({ signal }): Promise<ReviewFile> => {
      const file = await throwOnErr(() =>
        agentReviewClient.file(session, revision, path, signal)
      );
      return {
        ...file,
        rows: file.rows.map((row): ReviewFile['rows'][number] => {
          if (row.length !== 2) throw new Error('Invalid aligned diff row');
          return [row[0], row[1]];
        }),
      };
    },
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
  });

export function createReviewSource(
  session: Accessor<string | undefined>,
  revision: Accessor<number | undefined>,
  active: Accessor<boolean>
): ReviewSource {
  const client = useQueryClient();
  const manifest = useQuery(() => ({
    queryKey: [
      ...reviewKey(session() ?? ''),
      'manifest',
      revision() ?? 'latest',
    ] as const,
    queryFn: async ({ signal, queryKey }) => {
      const requested = queryKey[3];
      const { review } = await throwOnErr(() =>
        agentReviewClient.view(
          queryKey[1],
          typeof requested === 'number' ? requested : undefined,
          signal
        )
      );
      const number =
        typeof requested === 'number'
          ? requested
          : review?.revisions.at(-1)?.number;
      const files =
        review?.revisions.find((item) => item.number === number)?.files ?? [];
      const hidden = hiddenFiles(
        reviewFileGroups(files, review?.fileGroups ?? []),
        new Map()
      );
      const path =
        review?.tour.find((chapter) => !hidden.has(chapter.focus.path))?.focus
          .path ??
        files.find((file) => !hidden.has(file.path))?.path ??
        files[0]?.path;
      if (number && path)
        void client.prefetchQuery(fileOptions(queryKey[1], number, path));
      return {
        review,
        revision:
          typeof requested === 'number'
            ? requested
            : review?.revisions.at(-1)?.number,
      };
    },
    enabled: Boolean(session()) && active(),
    placeholderData: (previous, query) =>
      query?.queryKey[1] === session() ? previous : undefined,
    retry: false,
    staleTime: 5_000,
    refetchInterval: active() ? 10_000 : false,
  }));
  const invalidate = () =>
    client.invalidateQueries({
      queryKey: [...reviewKey(session() ?? ''), 'manifest'],
    });
  onCleanup(
    subscribeAgentSessionUpdated((event) => {
      if (event.agentSessionId === session()) void invalidate();
    })
  );
  const capture = useMutation(() => ({
    mutationFn: () => throwOnErr(() => agentReviewClient.capture(session()!)),
    onSuccess: invalidate,
    retry: false,
  }));
  const comment = useMutation(() => ({
    mutationFn: (input: Comment) =>
      throwOnErr(() => agentReviewClient.comment(session()!, input)),
    onSuccess: invalidate,
    retry: false,
  }));
  const resolve = useMutation(() => ({
    mutationFn: (input: { thread: string; resolved: boolean }) =>
      throwOnErr(() =>
        agentReviewClient.resolve(session()!, input.thread, input.resolved)
      ),
    onSuccess: invalidate,
    retry: false,
  }));
  return {
    manifest: {
      value: () =>
        queryReadyGate(manifest)
          ? (manifest.data.review ?? undefined)
          : undefined,
      phase: () =>
        manifest.isError
          ? 'error'
          : manifest.isPending || manifest.isPlaceholderData
            ? 'loading'
            : 'ready',
      error: () => manifest.error,
      refresh: async () => (await manifest.refetch()).data?.review ?? undefined,
    },
    loadedRevision: () =>
      queryReadyGate(manifest) ? manifest.data.revision : undefined,
    capturing: () => capture.isPending,
    commenting: () => comment.isPending,
    capture: () => capture.mutateAsync(),
    comment: (input) => comment.mutateAsync(input),
    resolve: (input) => resolve.mutateAsync(input),
  };
}
export function createReviewFile(
  session: Accessor<string | undefined>,
  revision: Accessor<number | undefined>,
  path: Accessor<string | undefined>,
  active: Accessor<boolean>
): ReviewData<ReviewFile> {
  const file = useQuery(() => ({
    ...fileOptions(session() ?? '', revision() ?? 0, path() ?? ''),
    enabled: Boolean(session() && revision() && path()) && active(),
    placeholderData: (previous, query) =>
      query?.queryKey[1] === session() && previous?.path === path()
        ? previous
        : undefined,
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
  }));
  return {
    value: () => (queryReadyGate(file) ? file.data : undefined),
    phase: () =>
      file.isError
        ? 'error'
        : file.isPending || file.isPlaceholderData
          ? 'loading'
          : 'ready',
    error: () => file.error,
    refresh: async () => (await file.refetch()).data,
  };
}
