import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import {
  type InfiniteData,
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/solid-query';
import type { SoupAstBody, SoupAstItemsPage, SoupAstParams } from '../items';
import { soupKeys } from '../keys';
import { parseGroupedSoupPage, serializeGroupByField } from './api';
import type { GroupByField, GroupedSoupPage } from './types';

const FETCH_KEY = ['soup', 'group-fetch'] as const;

type FetchVars = {
  groupKey: string;
  cursor: string;
  field: GroupByField;
  soupParams: SoupAstParams;
  soupBody: SoupAstBody;
};

type FetchSnapshot = {
  groupKey: string | undefined;
  status: 'idle' | 'pending' | 'success' | 'error';
  error: Error | null;
  submittedAt: number;
};

function appendGroupPage(
  prev: InfiniteData<SoupAstItemsPage, string | null> | undefined,
  groupKey: string,
  response: GroupedSoupPage
) {
  if (!prev?.pages.length) return prev;

  const firstPage = prev.pages[0];
  if (firstPage.kind !== 'grouped') return prev;
  if (!firstPage.groups.some((g) => g.key === groupKey)) return prev;

  const items = { ...firstPage.items, ...response.items };

  const fetched = response.groups.find((g) => g.key === groupKey);
  const newIds = fetched?.itemIds ?? [];
  const newCursor = fetched?.nextCursor ?? null;

  const groups = firstPage.groups.map((g) => {
    if (g.key !== groupKey) return g;
    const existing = new Set(g.itemIds);
    const appended = newIds.filter((id) => !existing.has(id));
    if (appended.length === 0 && g.nextCursor === newCursor) return g;
    return {
      ...g,
      itemIds: [...g.itemIds, ...appended],
      nextCursor: newCursor,
    };
  });

  return {
    ...prev,
    pages: [{ ...firstPage, items, groups }, ...prev.pages.slice(1)],
  };
}

export const useFetchGroupPage = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation(() => ({
    mutationKey: FETCH_KEY,
    mutationFn: async (vars: FetchVars) => {
      const response = await throwOnErr(async () =>
        storageServiceClient.getGroupedSoupAstItems({
          params: {
            cursor: vars.cursor,
            group_by: serializeGroupByField(vars.field),
            group_key: vars.groupKey,
          },
          body: { ...vars.soupBody, ...vars.soupParams },
        })
      );
      return parseGroupedSoupPage(response);
    },
    onSuccess: (parsed, vars) => {
      const queryKey = soupKeys.astItems({
        params: vars.soupParams,
        body: vars.soupBody,
        groupBy: vars.field,
      }).queryKey;
      queryClient.setQueryData<
        InfiniteData<SoupAstItemsPage, string | null> | undefined
      >(queryKey, (prev) => appendGroupPage(prev, vars.groupKey, parsed));
    },
  }));

  const snapshots = useMutationState<FetchSnapshot>(() => ({
    filters: { mutationKey: FETCH_KEY },
    select: (m) => ({
      groupKey: (m.state.variables as FetchVars | undefined)?.groupKey,
      status: m.state.status,
      error: m.state.error as Error | null,
      submittedAt: m.state.submittedAt,
    }),
  }));

  const latestForGroup = (k: string) => {
    let latest: FetchSnapshot | undefined;
    for (const s of snapshots()) {
      if (s.groupKey !== k) continue;
      if (!latest || s.submittedAt > latest.submittedAt) latest = s;
    }
    return latest;
  };

  return {
    fetch: async (vars: FetchVars) => {
      if (latestForGroup(vars.groupKey)?.status === 'pending') return;
      await mutation.mutateAsync(vars);
    },
    isPending: (k: string) => latestForGroup(k)?.status === 'pending',
    error: (k: string) => {
      const latest = latestForGroup(k);
      return latest?.status === 'error' ? latest.error : undefined;
    },
  };
};
