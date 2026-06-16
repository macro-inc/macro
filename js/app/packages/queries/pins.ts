import { toast } from '@core/component/Toast/Toast';
import { queryClient } from '@queries/client';
import { syncServiceClient, type VersionPin } from '@service-sync/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

const pinKeys = {
  list: (documentId: string) => ['pins', documentId] as const,
};

export function usePinsQuery(documentId: Accessor<string>) {
  return useQuery<VersionPin[]>(() => ({
    queryKey: pinKeys.list(documentId()),
    queryFn: async () => {
      const maybe = await syncServiceClient.getPins({ documentId: documentId() });
      if (maybe.isErr()) throw new Error(maybe.error);
      return maybe.value;
    },
  }));
}

export function invalidatePins(documentId: string) {
  return queryClient.invalidateQueries({ queryKey: pinKeys.list(documentId) });
}

export function useCreatePinMutation(documentId: Accessor<string>) {
  return useMutation(() => ({
    mutationFn: async (vars: { atMs: number; label: string }) => {
      const maybe = await syncServiceClient.createPin({
        documentId: documentId(),
        label: vars.label,
        pinnedAtMs: vars.atMs,
      });
      if (maybe.isErr()) throw new Error(maybe.error);
      return maybe.value;
    },
    onSuccess: () => invalidatePins(documentId()),
    onError: () => toast.failure('Label may only contain letters, dashes, and underscores'),
  }));
}

export function useDeletePinMutation(documentId: Accessor<string>) {
  return useMutation(() => ({
    mutationFn: async (pinId: string) => {
      const maybe = await syncServiceClient.deletePin({
        documentId: documentId(),
        pinId,
      });
      if (maybe.isErr()) throw new Error(maybe.error);
    },
    onSuccess: () => invalidatePins(documentId()),
  }));
}
