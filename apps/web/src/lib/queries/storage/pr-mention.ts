import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { pullRequestMentionKeys } from './keys';

const PR_MENTION_STALE_TIME = 60 * 1000;

type EnabledInput = boolean | Accessor<boolean>;

function readEnabled(enabled: EnabledInput | undefined): boolean {
  if (enabled === undefined) return true;
  return typeof enabled === 'function' ? enabled() : enabled;
}

function prMentionQueryOptions(id: string) {
  return {
    queryKey: pullRequestMentionKeys.foreignEntity(id).queryKey,
    queryFn: async (): Promise<ForeignEntity> =>
      await throwOnErr(() => storageServiceClient.getForeignEntity({ id })),
    staleTime: PR_MENTION_STALE_TIME,
    retry: 1,
  };
}

export function usePrMentionQuery(
  id: Accessor<string>,
  enabled?: EnabledInput
) {
  return useQuery(() => ({
    ...prMentionQueryOptions(id()),
    enabled: !!id() && readEnabled(enabled),
  }));
}
