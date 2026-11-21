/**
 * Probe for the PR branch (the new head): the same callers as `old.tsx`, read
 * through the branch's code. Requests come from the branch's exported `*_ARGS`
 * where it exports them; `documentMetadataArgs` is module-private, so its copy
 * is verbatim (DocumentTitleHoverCard.tsx:27).
 */

import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { FIG_LIBRARY_DESIGNS_ARGS, useFigLibrarySource } from '@app/features/block-fig/queries/fig-libraries';
import { taskDuplicatesArgs } from '@app/features/block-md/component/TaskDuplicateList';
import { fetchPrLinks } from '@app/features/block-pr/queries/pr-links-query';
import { useQuickAccessCrmCompaniesQuery } from '@app/features/crm/crm-search';
import { CRM_EXPORT_COMPANIES_ARGS, fetchCrmExportCompanies } from '@app/features/crm/queries/export';
import { QUICK_ACCESS_CRM_COMPANIES_ARGS } from '@app/features/crm/queries/company-suggestions';
import {
  RECENT_CHATS_ARGS,
  useRecentChatSessions,
} from '@app/features/home/home-recent-sessions';
import {
  RECENT_EMAIL_THREADS_ARGS,
  useEmailSearchMention,
} from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useEmailSearchMention';
import { createQuickAccessValue } from '@core/context/quickAccess/QuickAccessSource';
import { formatDate } from '@core/util/date';
import { queryClient } from '@queries/client';
import { queryReadyGate } from '@queries/gate';
import { fetchRestPreviewBatch } from '@queries/preview/fetchers';
import { soupRestFallback } from '@queries/soup/graphql/rest-fallback';
import {
  QUICK_ACCESS_FEED_OPTIONS,
  type SoupAstItemsQuery,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { QUICK_ACCESS_AGENT_SESSIONS_ARGS, useQuickAccessAgentSessionsQuery } from '@queries/soup/quick-access-agent-sessions';
import { QUICK_ACCESS_INITIATIVES_ARGS, useQuickAccessInitiativesQuery } from '@queries/soup/quick-access-initiatives';
import { QUICK_ACCESS_SKILLS_ARGS, useQuickAccessSkillsQuery } from '@queries/soup/quick-access-skills';
import { QUICK_ACCESS_SNIPPETS_ARGS, useQuickAccessSnippetsQuery } from '@queries/soup/quick-access-snippets';
import { RECENTLY_VIEWED_ARGS, useRecentlyViewedSoupQuery } from '@queries/soup/recently-viewed';
import { SLASH_MENU_PULL_REQUESTS_ARGS, useSlashMenuPullRequests } from '@queries/soup/slash-menu-pull-requests';
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

function soupStatus(query: SoupAstItemsQuery) {
  return {
    transport: query.transport,
    isPending: query.isPending,
    isFetching: query.isFetching,
    error: errorText(query.error),
  };
}

function soupSettled(query: SoupAstItemsQuery) {
  return (
    ((!query.isPending && query.data !== undefined) || query.error !== null) &&
    !query.isFetching
  );
}

// DocumentTitleHoverCard.tsx:27 on the branch.
function documentMetadataArgs(documentId: string): SoupAstItemsQueryArgs {
  return {
    params: { limit: 1 },
    body: compileToAst(
      queryStateFrom(defineQueryFilters({ include: { documentId: [documentId] } }))
    ),
  };
}

type QueryAndList = { query: SoupAstItemsQuery; list: () => unknown };

function feed(make: () => QueryAndList) {
  return () => {
    const { query, list } = make();
    return () =>
      ({
        settled: soupSettled(query),
        data: query.data?.entities,
        caller: list(),
        status: soupStatus(query),
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
  'home.recentChats': {
    build: (p) => () => {
      const chats = useRecentChatSessions(p?.limit ?? 3);
      const query = useSoupAstItemsQuery(() => RECENT_CHATS_ARGS);
      return () => ({
        settled: soupSettled(query),
        data: query.data?.entities,
        caller: chats(),
        status: soupStatus(query),
      });
    },
  },
  recentlyViewed: {
    build: () => () => {
      const query = useRecentlyViewedSoupQuery();
      return () => ({
        settled: (query.isSuccess || query.isError) && !query.isFetching,
        data: query.data,
        caller: query.data,
        status: {
          isPending: query.isPending,
          isFetching: query.isFetching,
          error: errorText(query.error),
        },
      });
    },
  },
  'fig.libraries': {
    build: (p) => () => {
      const source = useFigLibrarySource(p.documentId);
      const query = useSoupAstItemsQuery(() => FIG_LIBRARY_DESIGNS_ARGS);
      return () => ({
        settled: soupSettled(query),
        data: query.data?.entities,
        caller: { documentId: source.documentId, documents: source.documents() },
        status: soupStatus(query),
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
      const query = useSoupAstItemsQuery(
        () => RECENT_EMAIL_THREADS_ARGS,
        () => ({ ...QUICK_ACCESS_FEED_OPTIONS, staleTime: 0 })
      );
      return () => ({
        settled: soupSettled(query),
        data: query.data?.entities,
        caller: {
          emails: mention.emails(),
          totalCount: mention.totalCount(),
          hasMore: mention.hasMore(),
        },
        status: soupStatus(query),
      });
    },
  },
  hover: {
    build: (p) => () => {
      const query = useSoupAstItemsQuery(
        () => documentMetadataArgs(p.documentId),
        () => ({
          graphqlCacheFirstEntities: [
            { entityType: 'DOCUMENT', entityId: p.documentId },
          ],
        })
      );
      // DocumentTitleHoverCard.tsx:52-65 on the branch, with no props or cache entry.
      const resolved = () =>
        queryReadyGate(query)
          ? query.data.entities.find((item) => item.id === p.documentId)
          : undefined;
      const timestamp = (value: unknown) =>
        value ? formatDate(value as string, { showTime: true }) : 'Not available';
      return () => ({
        settled: soupSettled(query),
        data: query.data?.entities,
        caller: {
          owner: resolved()?.ownerId ?? null,
          created: timestamp(resolved()?.createdAt),
          updated: timestamp(resolved()?.updatedAt),
        },
        status: soupStatus(query),
      });
    },
  },
  taskDup: {
    build: (p) => () => {
      const ids: string[] = p.ids;
      const query = useSoupAstItemsQuery(
        () => taskDuplicatesArgs(ids),
        () => ({ enabled: ids.length > 0, keepPreviousData: true })
      );
      // TaskDuplicateList.tsx:83-89 on the branch.
      const entities = () => {
        const order = new Map(ids.map((id, index) => [id, index] as const));
        return [...(query.data?.entities ?? [])]
          .filter((entity) => order.has(entity.id))
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      };
      return () => ({
        settled: ids.length === 0 || soupSettled(query),
        data: query.data?.entities,
        caller: entities(),
        status: soupStatus(query),
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
          (pages() >= wanted() || !query.hasNextPage || query.error !== null) && soupSettled(query),
        data: query.data
          ? { entities: query.data.entities, groups: query.data.groups }
          : null,
        caller: null,
        status: {
          pages: pages(), ...soupStatus(query), hasNextPage: query.hasNextPage },
      });
    },
  },
};

async function oneShot(name: string, p: Params): Promise<unknown> {
  switch (name) {
    case 'crm.export': {
      const progress: number[] = [];
      const companies = await fetchCrmExportCompanies(
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

/** The branch's translator verdict: the fallback it traces, or null. */
function translate(args: SoupAstItemsQueryArgs) {
  return soupRestFallback(args) ?? null;
}

const probe = {
  side: 'new' as const,
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
  args: { QUICK_ACCESS_CRM_COMPANIES_ARGS },
  /** The moved callers' own requests, which the translator fuzz mutates. */
  bases: () =>
    plain({
      'qa.agentSessions': QUICK_ACCESS_AGENT_SESSIONS_ARGS,
      'qa.initiatives': QUICK_ACCESS_INITIATIVES_ARGS,
      'qa.skills': QUICK_ACCESS_SKILLS_ARGS,
      'qa.snippets': QUICK_ACCESS_SNIPPETS_ARGS,
      'crm.suggestions': QUICK_ACCESS_CRM_COMPANIES_ARGS,
      'crm.export': CRM_EXPORT_COMPANIES_ARGS,
      'home.recentChats': RECENT_CHATS_ARGS,
      recentlyViewed: RECENTLY_VIEWED_ARGS,
      'slash.prs': SLASH_MENU_PULL_REQUESTS_ARGS,
      'fig.libraries': FIG_LIBRARY_DESIGNS_ARGS,
      'email.recent': RECENT_EMAIL_THREADS_ARGS,
    }),
};

(window as unknown as { __probe: typeof probe }).__probe = probe;
export default probe;
