import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { emailKeys } from '@queries/email/keys';
import { useTagsQuery } from '@queries/properties/tags';
import { emailClient } from '@service-email/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

async function fetchEmailLabels() {
  return await throwOnErr(async () => await emailClient.getUserLabels());
}

function emailLabelsQueryOptions() {
  return queryOptions({
    queryKey: emailKeys.labels.queryKey,
    queryFn: fetchEmailLabels,
    staleTime: 5 * 60 * 1000,
  });
}

/** Whether a picker's options are still loading or failed to load. */
export type SourceStatus = 'pending' | 'error' | 'ready';

/**
 * Options read through `read`, kept through a failed refetch (FE-48), with
 * the query's status and a retry for the picker's empty state.
 */
function optionSource<T>(
  query: {
    isPending: boolean;
    isError: boolean;
    refetch(): Promise<unknown>;
  },
  read: () => T[]
): Accessor<T[]> & { status: Accessor<SourceStatus>; retry(): void } {
  // Reading data while pending would suspend; after that it is safe.
  const options = () => (query.isPending ? [] : read());
  return Object.assign(options, {
    status: (): SourceStatus =>
      query.isError ? 'error' : query.isPending ? 'pending' : 'ready',
    retry: () => fireAndForget(query.refetch(), 'routines'),
  });
}

/** Custom Gmail label names across the user's inboxes, for label steps. */
export function useEmailLabelNames() {
  const query = useQuery(() => emailLabelsQueryOptions());
  return optionSource(query, () =>
    [
      ...new Set(
        (query.data?.labels ?? [])
          .filter((label) => label.type === 'User')
          .map((label) => label.name.trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b))
  );
}

export type RoutineTagOption = {
  definitionId: string;
  optionId: string;
  label: string;
  color?: string;
  scope: string;
};

/** Every tag the user can apply, personal and team. */
export function useRoutineTags() {
  const query = useTagsQuery();
  return optionSource(query, (): RoutineTagOption[] =>
    (query.data ?? []).flatMap((set) =>
      set.options.map((option) => ({
        definitionId: option.propertyDefinitionId,
        optionId: option.id,
        label: option.value.type === 'string' ? option.value.value : '',
        color: option.color ?? undefined,
        scope: set.scope,
      }))
    )
  );
}
