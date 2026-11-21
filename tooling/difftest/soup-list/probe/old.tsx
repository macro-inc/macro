/**
 * Probe for main (the old head): every former caller of `useSoupItemsQuery`
 * and `getSoupItems`, read through main's own code.
 *
 * Where main's request is inline in a component, the copy below is verbatim
 * (file:line in the comment). For hooks the probe also mounts, it checks the
 * copy against the live hook: both must share one TanStack query.
 */
import { useFigLibrarySource } from '@app/features/block-fig/queries/fig-libraries';
import { fetchPrLinks } from '@app/features/block-pr/queries/pr-links-query';
import { useQuickAccessCrmCompaniesQuery } from '@app/features/crm/crm-search';
import { fetchCrmExportCompanies } from '@app/features/crm/queries/export';
import { useRecentChatSessions } from '@app/features/home/home-recent-sessions';
import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { useEmailSearchMention } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useEmailSearchMention';
import { createQuickAccessValue } from '@core/context/quickAccess/QuickAccessSource';
import { formatDate } from '@core/util/date';
import { queryClient } from '@queries/client';
import { fetchRestPreviewBatch } from '@queries/preview/fetchers';
import {
  makeGraphqlGroupedSoupInput,
  makeGraphqlSoupInput,
} from '@queries/soup/graphql/ast';
import {
  type SoupAstItemsQueryArgs,
  type SoupItemsQueryArgs,
  useSoupAstItemsQuery,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { soupKeys } from '@queries/soup/keys';
import { useQuickAccessAgentSessionsQuery } from '@queries/soup/quick-access-agent-sessions';
import { useQuickAccessInitiativesQuery } from '@queries/soup/quick-access-initiatives';
import { useQuickAccessSkillsQuery } from '@queries/soup/quick-access-skills';
import { useQuickAccessSnippetsQuery } from '@queries/soup/quick-access-snippets';
import { useRecentlyViewedSoupQuery } from '@queries/soup/recently-viewed';
import { useSlashMenuPullRequests } from '@queries/soup/slash-menu-pull-requests';
import { storageServiceClient } from '@service-storage/client';
import { isGithubPrEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { createEffect, createMemo, createSignal } from 'solid-js';
import {
  errorText,
  flushTelemetry,
  mountedKeys,
  mountWith,
  plain,
  type Snapshot,
  snapshot,
  unmount,
  unmountAll,
} from './common';
import { runWrite } from './writes';

type TanstackLike = {
  isPending: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  data: unknown;
};

function tanstackStatus(query: TanstackLike) {
  return {
    isPending: query.isPending,
    isFetching: query.isFetching,
    error: errorText(query.error),
  };
}

function tanstackSettled(query: TanstackLike) {
  return (query.isSuccess || query.isError) && !query.isFetching;
}

/** Whether `args` is the key of a query `observers` hooks read. */
function sharesQuery(args: SoupItemsQueryArgs, observers = 2) {
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: soupKeys.items(args).queryKey, exact: true });
  return (query?.getObserversCount() ?? 0) >= observers;
}

// home-recent-sessions.tsx:49 on main.
const RECENT_CHATS_ARGS: SoupItemsQueryArgs = {
  params: { sort_method: 'updated_at', limit: 10 },
  body: { ...QUERY_FILTERS_BASE, chat_filters: undefined },
};

// useEmailSearchMention.ts:21 on main.
const RECENT_EMAIL_THREADS_ARGS: SoupItemsQueryArgs = {
  params: { limit: 20, sort_method: 'updated_at' },
  body: { ...QUERY_FILTERS_BASE, email_filters: {} },
};

// fig-libraries.ts:24 on main.
const FIG_ARGS: SoupItemsQueryArgs = {
  params: { limit: 200, sort_method: 'viewed_updated' },
  body: { ...QUERY_FILTERS_BASE, document_filters: { file_types: ['fig'] } },
};

// DocumentTitleHoverCard.tsx:24 on main.
const hoverArgs = (documentId: string): SoupItemsQueryArgs => ({
  params: { limit: 1 },
  body: { ...QUERY_FILTERS_BASE, document_filters: { document_ids: [documentId] } },
});

// TaskDuplicateList.tsx:55 on main.
const taskDuplicateArgs = (ids: string[]): SoupItemsQueryArgs => ({
  params: { limit: 25 },
  body: {
    ...QUERY_FILTERS_BASE,
    document_filters: { document_ids: ids, sub_types: ['task'] },
  },
});

type QueryAndList = { query: TanstackLike; list: () => unknown };

function feed(make: () => QueryAndList) {
  return () => {
    const { query, list } = make();
    return () =>
      ({
        settled: tanstackSettled(query),
        data: query.data,
        caller: list(),
        status: tanstackStatus(query),
      }) satisfies Snapshot;
  };
}

// biome-ignore lint/suspicious/noExplicitAny: probe parameters are JSON
type Params = any;

const callers: Record<
  string,
  { build: (p: Params) => () => () => Snapshot; quickAccess?: boolean }
> = {
  'qa.agentSessions': {
    build: () =>
      feed(() => {
        const { query, sessions } = useQuickAccessAgentSessionsQuery();
        return { query, list: sessions };
      }),
  },
  'qa.initiatives': {
    build: () =>
      feed(() => {
        const { query, initiatives } = useQuickAccessInitiativesQuery();
        return { query, list: initiatives };
      }),
  },
  'qa.skills': {
    build: () =>
      feed(() => {
        const { query, skills } = useQuickAccessSkillsQuery();
        return { query, list: skills };
      }),
  },
  'qa.snippets': {
    build: () =>
      feed(() => {
        const { query, snippets } = useQuickAccessSnippetsQuery();
        return { query, list: snippets };
      }),
  },
  'crm.suggestions': {
    build: () =>
      feed(() => {
        const { query, companies } = useQuickAccessCrmCompaniesQuery();
        return { query, list: companies };
      }),
  },
  'slash.prs': {
    build: () =>
      feed(() => {
        const { query, pullRequests } = useSlashMenuPullRequests(() => true);
        return { query, list: pullRequests };
      }),
  },
  // Main's slash-menu PR query with the one option the branch adds that
  // changes rows (showSupportedForeignEntities): what main's menu would show
  // had it asked for PRs the way the PR list does. The branch must match it.
  'slash.prsOracle': {
    build: () =>
      feed(() => {
        const query = useSoupItemsQuery(
          () => ({
            params: { limit: 500, sort_method: 'viewed_updated' },
            body: {
              ...QUERY_FILTERS_BASE,
              foreign_entity_filters: {
                foreign_entity_sources: ['github_pull_request'],
              },
            },
          }),
          () => ({ staleTime: 60_000, showSupportedForeignEntities: true })
        );
        const list = createMemo(() =>
          queryReadyGate(query) ? query.data.filter(isGithubPrEntity) : []
        );
        return { query, list };
      }),
  },
  'home.recentChats': {
    build: (p) => () => {
      const chats = useRecentChatSessions(p?.limit ?? 3);
      const query = useSoupItemsQuery(() => RECENT_CHATS_ARGS);
      return () => ({
        settled: tanstackSettled(query),
        data: query.data,
        caller: chats(),
        status: {
          ...tanstackStatus(query),
          copyVerified: sharesQuery(RECENT_CHATS_ARGS),
        },
      });
    },
  },
  recentlyViewed: {
    build: () => () => {
      const query = useRecentlyViewedSoupQuery();
      return () => ({
        settled: tanstackSettled(query),
        data: query.data,
        caller: query.data,
        status: tanstackStatus(query),
      });
    },
  },
  'fig.libraries': {
    build: (p) => () => {
      const source = useFigLibrarySource(p.documentId);
      // The hook's own reader, read again under the same key.
      const query = useSoupItemsQuery(
        () => FIG_ARGS,
        () => ({ staleTime: 60 * 1000 })
      );
      return () => ({
        settled: tanstackSettled(query),
        data: query.data,
        caller: { documentId: source.documentId, documents: source.documents() },
        status: {
          ...tanstackStatus(query),
          copyVerified: sharesQuery(FIG_ARGS),
        },
      });
    },
  },
  'email.recent': {
    quickAccess: true,
    build: (p) => () => {
      const mention = useEmailSearchMention({
        searchTerm: () => p?.term ?? '',
        enabled: () => true,
        recentWhenShort: () => true,
      });
      const query = useSoupItemsQuery(
        () => RECENT_EMAIL_THREADS_ARGS,
        () => ({ staleTime: 0 })
      );
      return () => ({
        settled: tanstackSettled(query),
        data: query.data,
        caller: {
          emails: mention.emails(),
          totalCount: mention.totalCount(),
          hasMore: mention.hasMore(),
        },
        status: {
          ...tanstackStatus(query),
          copyVerified: sharesQuery(RECENT_EMAIL_THREADS_ARGS),
        },
      });
    },
  },
  hover: {
    build: (p) => () => {
      const query = useSoupItemsQuery(
        () => hoverArgs(p.documentId),
        () => ({ staleTime: 60_000 })
      );
      // DocumentTitleHoverCard.tsx:37-55 on main, with no props or cache entry.
      const resolved = () =>
        query.isSuccess
          ? query.data.find((item) => item.id === p.documentId)
          : undefined;
      const timestamp = (value: unknown) =>
        value ? formatDate(value as string, { showTime: true }) : 'Not available';
      return () => ({
        settled: tanstackSettled(query),
        data: query.data,
        caller: {
          owner: resolved()?.ownerId ?? null,
          created: timestamp(resolved()?.createdAt),
          updated: timestamp(resolved()?.updatedAt),
        },
        status: tanstackStatus(query),
      });
    },
  },
  taskDup: {
    build: (p) => () => {
      const ids: string[] = p.ids;
      const query = useSoupItemsQuery(
        () => taskDuplicateArgs(ids),
        () => ({ enabled: ids.length > 0, staleTime: 30 * 1000 })
      );
      // TaskDuplicateList.tsx:66-72 on main.
      const entities = () => {
        const order = new Map(ids.map((id, index) => [id, index] as const));
        return [...(query.data ?? [])]
          .filter((entity) => order.has(entity.id))
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      };
      return () => ({
        settled: ids.length === 0 || tanstackSettled(query),
        data: query.data,
        caller: entities(),
        status: tanstackStatus(query),
      });
    },
  },
  quickAccess: {
    quickAccess: true,
    build: (p) => () => {
      const value = createQuickAccessValue();
      // `menu`: the options form an open `/` or @ menu uses (useEntityMention),
      // which reads the cache projection and counts as a list reading the cache.
      const list = p?.menu
        ? value.useList({ buckets: (p?.buckets ?? []) as never, searchTerm: () => '', enabled: () => true })
        : value.useList(...((p?.buckets ?? []) as []));
      const items = createMemo(() => list.items());
      return () => ({
        settled: !value.isLoading(),
        data: null,
        caller: items().map((item) => ({
          kind: item.kind,
          bucket: (item as { bucket?: string }).bucket,
          id: (item as { id?: string }).id,
          name: (item as { name?: string }).name,
          searchText: (item as { searchText?: string }).searchText,
          timestamps: (item as { timestamps?: unknown }).timestamps,
          sortTimestamp: (item as { sortTimestamp?: number }).sortTimestamp,
        })),
        status: { isLoading: value.isLoading() },
      });
    },
  },
  // main's REST reader with any args and options: the oracle for deliberate
  // option changes (slash-menu PRs with showSupportedForeignEntities).
  legacy: {
    build: (p) => () => {
      const query = useSoupItemsQuery(() => p.args, () => p.options ?? {});
      return () => ({
        settled: tanstackSettled(query),
        data: query.data,
        caller: null,
        status: { ...tanstackStatus(query), hasNextPage: query.hasNextPage },
      });
    },
  },
  ast: {
    build: (p) => () => {
      const args: SoupAstItemsQueryArgs = p.args;
      const query = useSoupAstItemsQuery(() => args, () => p.options ?? {});
      // Continuation pages: read up to p.pages pages, one at a time.
      const [pages, setPages] = createSignal(1);
      const wanted = () => (p.pages as number | undefined) ?? 1;
      const idle = () =>
        ((!query.isPending && query.data !== undefined) || query.error !== null) &&
        !query.isFetching;
      // One continuation at a time: a second fetchNextPage while one is in
      // flight would cancel it (TanStack cancelRefetch).
      const [inFlight, setInFlight] = createSignal(false);
      createEffect(() => {
        if (!inFlight() && idle() && !query.error && query.hasNextPage && pages() < wanted()) {
          setInFlight(true);
          setPages(pages() + 1);
          void query.fetchNextPage().finally(() => {
            setInFlight(false);
          });
        }
      });
      return () => ({
        settled:
          !inFlight() &&
          (pages() >= wanted() || !query.hasNextPage || query.error !== null) &&
          ((!query.isPending && query.data !== undefined) ||
            query.error !== null) &&
          !query.isFetching,
        data: query.data
          ? { entities: query.data.entities, groups: query.data.groups }
          : null,
        caller: null,
        status: {
          pages: pages(),
          transport: query.transport,
          isPending: query.isPending,
          isFetching: query.isFetching,
          hasNextPage: query.hasNextPage,
          error: errorText(query.error),
        },
      });
    },
  },
};

async function oneShot(name: string, p: Params): Promise<unknown> {
  switch (name) {
    case 'crm.export': {
      const progress: number[] = [];
      const companies = await fetchCrmExportCompanies(
        storageServiceClient,
        new AbortController().signal,
        (count) => progress.push(count)
      );
      return plain({ companies, progress });
    }
    case 'preview.initiatives': {
      const batch = await fetchRestPreviewBatch(
        (p.ids as string[]).map((id) => ({ id, type: 'initiative' as const }))
      );
      return plain(batch);
    }
    case 'prLinks':
      return plain(await fetchPrLinks(p.targets));
    default:
      throw new Error(`unknown one-shot ${name}`);
  }
}

/** Main's translator: the reason it throws, or null when it translates. */
function translate(args: SoupAstItemsQueryArgs): string | null {
  try {
    if (args.groupBy)
      makeGraphqlGroupedSoupInput({
        params: args.params,
        body: args.body,
        groupBy: args.groupBy,
      });
    else makeGraphqlSoupInput({ params: args.params, body: args.body });
    return null;
  } catch (error) {
    return errorText(error);
  }
}

const probe = {
  side: 'old' as const,
  mount(key: string, name: string, params?: Params) {
    const caller = callers[name];
    if (!caller) throw new Error(`unknown caller ${name}`);
    mountWith(key, caller.build(params), { quickAccess: caller.quickAccess });
  },
  snapshot,
  unmount,
  unmountAll,
  mountedKeys,
  oneShot: async (name: string, params?: Params) => {
    try {
      return { ok: true, value: await oneShot(name, params) };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  },
  translate,
  write: runWrite,
  flushTelemetry,
  resetQueries: () => {
    unmountAll();
    queryClient.clear();
  },
};

(window as unknown as { __probe: typeof probe }).__probe = probe;
export default probe;
