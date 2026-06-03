import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import {
  hashKey,
  type InfiniteData,
  type QueryKey,
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/solid-query';
import type { SoupAstBody, SoupAstItemsPage, SoupAstParams } from '../items';
import { parseGroupMeta, serializeGroupByField } from './api';
import type { GroupByField, GroupedSoupPage } from './types';

const FETCH_KEY = ['soup', 'group-fetch'] as const;

type FetchVars = {
  queryKey: QueryKey;
  groupKey: string;
  cursor: string;
  field: GroupByField;
  soupParams: SoupAstParams;
  soupBody: SoupAstBody;
};

type FetchSnapshot = {
  queryHash: string | undefined;
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

  const fetched = response.groups.find((g) => g.key === groupKey);
  if (!fetched) return prev;

  const items = { ...firstPage.items, ...response.items };
  const newIds = fetched.itemIds;
  const newCursor = fetched.nextCursor;

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
        storageServiceClient.getGroupedSoupAstGroupPage({
          params: {
            cursor: vars.cursor,
            group_by: serializeGroupByField(vars.field),
            group_key: vars.groupKey,
            limit: vars.soupParams.limit,
          },
          body: vars.soupBody,
        })
      );

      return {
        items: response.items,
        nextCursor: null,
        groups: [parseGroupMeta(response.group)],
      };
    },
    onSuccess: (parsed, vars) => {
      console.log(parsed);
      queryClient.setQueryData<
        InfiniteData<SoupAstItemsPage, string | null> | undefined
      >(vars.queryKey, (prev) => appendGroupPage(prev, vars.groupKey, parsed));
    },
  }));

  const snapshots = useMutationState<FetchSnapshot>(() => ({
    filters: { mutationKey: FETCH_KEY },
    select: (m) => {
      const vars = m.state.variables as FetchVars | undefined;
      return {
        queryHash: vars ? hashKey(vars.queryKey) : undefined,
        groupKey: vars?.groupKey,
        status: m.state.status,
        error: m.state.error as Error | null,
        submittedAt: m.state.submittedAt,
      };
    },
  }));

  const latestForGroup = (queryKey: QueryKey, groupKey: string) => {
    const queryHash = hashKey(queryKey);
    let latest: FetchSnapshot | undefined;
    for (const s of snapshots()) {
      if (s.queryHash !== queryHash || s.groupKey !== groupKey) continue;

      if (!latest || s.submittedAt > latest.submittedAt) {
        latest = s;
      }
    }
    return latest;
  };

  return {
    fetch: async (vars: FetchVars) => {
      if (latestForGroup(vars.queryKey, vars.groupKey)?.status === 'pending') {
        return;
      }
      await mutation.mutateAsync(vars);
    },
    isPending: (queryKey: QueryKey, groupKey: string) => {
      return latestForGroup(queryKey, groupKey)?.status === 'pending';
    },
  };
};
