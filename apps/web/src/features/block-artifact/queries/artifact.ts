import { throwOnErr } from '@core/util/result';
import { createQueryKeys } from '@lukemorales/query-key-factory';
import { queryClient } from '@queries/client';
import { artifactsClient } from '@service-storage/artifacts';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, untrack } from 'solid-js';
import type { ArtifactTheme } from '../core/frame-message';
import { viewUrlRefreshDelay } from '../core/view-url';

export const artifactKeys = createQueryKeys('artifacts', {
  detail: (documentId: string) => ({ queryKey: [documentId] }),
  versions: (documentId: string) => ({ queryKey: [documentId] }),
  version: (documentId: string, number: number) => ({
    queryKey: [documentId, number],
  }),
  viewUrl: (
    documentId: string,
    version: number | undefined,
    scene: string | undefined
  ) => ({ queryKey: [documentId, version ?? 'current', scene ?? 'index'] }),
});

export function useArtifactQuery(documentId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: artifactKeys.detail(documentId()).queryKey,
    queryFn: () =>
      throwOnErr(() => artifactsClient.get({ documentId: documentId() })),
    enabled: !!documentId(),
  }));
}

export function useArtifactVersionsQuery(
  documentId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    queryKey: artifactKeys.versions(documentId()).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        artifactsClient.listVersions({ documentId: documentId() })
      ),
    enabled: !!documentId() && enabled(),
  }));
}

/** One version's manifest; undefined `number` reads nothing. */
export function useArtifactVersionQuery(
  documentId: Accessor<string>,
  number: Accessor<number | undefined>
) {
  return useQuery(() => {
    const version = number();
    return {
      queryKey: artifactKeys.version(documentId(), version ?? 0).queryKey,
      queryFn: () =>
        throwOnErr(() =>
          artifactsClient.getVersion({
            documentId: documentId(),
            number: version ?? 0,
          })
        ),
      enabled: !!documentId() && version !== undefined,
      // A version never changes.
      staleTime: Number.POSITIVE_INFINITY,
    };
  });
}

export type ViewUrlTarget = {
  documentId: string;
  /** Omitted follows the current version. */
  version?: number;
  scene?: string;
};

/**
 * A view URL for the frame. It changes only when it is about to expire or
 * the artifact changes: each new URL reloads the page, so it is never
 * refetched on focus. The theme it carries is the one at request time; later
 * theme changes are posted to the frame instead.
 */
export function useArtifactViewUrlQuery(
  target: Accessor<ViewUrlTarget>,
  theme: Accessor<ArtifactTheme>
) {
  return useQuery(() => {
    const { documentId, version, scene } = target();
    return {
      queryKey: artifactKeys.viewUrl(documentId, version, scene).queryKey,
      queryFn: () =>
        throwOnErr(() =>
          artifactsClient.viewUrl({
            documentId,
            request: { version, scene, theme: untrack(theme) },
          })
        ),
      enabled: !!documentId,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: (query: {
        state: { data: { expires_at: string } | undefined };
      }) => {
        const expiresAt = query.state.data?.expires_at;
        if (!expiresAt) return false;
        return viewUrlRefreshDelay(expiresAt, Date.now()) ?? false;
      },
      refetchIntervalInBackground: true,
    };
  });
}

/** Re-reads everything about an artifact after a publish or restore. */
export function invalidateArtifact(documentId: string) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: artifactKeys.detail(documentId).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: artifactKeys.versions(documentId).queryKey,
    }),
    // Frames pinned to a version keep their page.
    queryClient.invalidateQueries({
      queryKey: [...artifactKeys.viewUrl._def, documentId, 'current'],
    }),
  ]);
}

export function useRestoreArtifactVersionMutation(
  documentId: Accessor<string>
) {
  return useMutation(() => ({
    mutationFn: (number: number) =>
      throwOnErr(() =>
        artifactsClient.restore({ documentId: documentId(), number })
      ),
    onSuccess: () => invalidateArtifact(documentId()),
  }));
}
