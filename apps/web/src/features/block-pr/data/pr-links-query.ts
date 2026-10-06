import { clause, compileClause, confine } from '@app/features/soup/filters';
import { throwOnErr } from '@core/util/result';
import {
  type EntityData,
  getTaskReferencedEntityIds,
  isTaskEntity,
} from '@entity';
import {
  getTaskPriorityOptionId,
  isTaskClosed,
} from '@entity/utils/task-properties';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { agentSessionPullRequestKeys } from '@queries/agent-session/keys';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { MessageParent } from '@service-agent-harness/generated/schemas';
import { storageServiceClient } from '@service-storage/client';
import { useQueries } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { prHtmlUrl, toGithubKey } from '../util/prKey';
import {
  buildPrLinks,
  type PrLinkSession,
  type PrLinkSessionParent,
  type PrLinks,
  type PrLinkTask,
  type PrPriorityId,
} from './pr-links';

/** The batch endpoints answer at most one Reviews page at a time. */
const LINKS_CHUNK_SIZE = 100;
const LINKS_STALE_TIME = 60_000;

const PRIORITY_BY_OPTION_ID: Record<string, PrPriorityId> = {
  [PROPERTY_OPTION_IDS.PRIORITY.URGENT]: 'urgent',
  [PROPERTY_OPTION_IDS.PRIORITY.HIGH]: 'high',
  [PROPERTY_OPTION_IDS.PRIORITY.MEDIUM]: 'medium',
  [PROPERTY_OPTION_IDS.PRIORITY.LOW]: 'low',
};

/** A pull request whose links to look up. */
export type PrLinksTarget = {
  url: string;
  githubKey: string;
  labels: readonly { name: string }[];
};

export const prLinksTarget = (pullRequest: {
  owner: string;
  repo: string;
  number: number;
  labels?: readonly { name: string }[] | null;
}): PrLinksTarget => ({
  url: prHtmlUrl(pullRequest),
  githubKey: toGithubKey(pullRequest),
  labels: pullRequest.labels ?? [],
});

const sessionParent = (
  parent: MessageParent | null | undefined
): PrLinkSessionParent | undefined => {
  if (!parent) return undefined;
  switch (parent.type) {
    case 'channel':
    case 'document':
    case 'crm_company':
    case 'crm_contact':
      return { type: parent.type, id: parent.id };
    default:
      return { type: 'other', id: parent.id };
  }
};

/** Soup rows for exactly `ids` of one entity target, with their properties. */
async function fetchSoupEntitiesById(
  target: 'df' | 'ccf',
  ids: readonly string[]
): Promise<EntityData[]> {
  if (ids.length === 0) return [];
  const field = target === 'df' ? 'documentId' : 'crmCompanyId';
  const page = await throwOnErr(() =>
    storageServiceClient.getSoupAstItems({
      params: {},
      body: {
        ...compileClause(
          confine({
            [target]: clause.or(...ids.map((id) => clause.eq(field, id))),
          })
        ),
        limit: ids.length,
        expand: true,
      },
    })
  );
  return page.items.filter(isDisplayableSoupItem).map(mapApiSoupItemToEntity);
}

const toLinkTask = (entity: EntityData): PrLinkTask | undefined => {
  if (!isTaskEntity(entity)) return undefined;
  const optionId = getTaskPriorityOptionId(entity);
  return {
    id: entity.id,
    name: entity.name,
    priority: (optionId && PRIORITY_BY_OPTION_ID[optionId]) || 'none',
    closed: isTaskClosed(entity),
    companyIds: getTaskReferencedEntityIds(
      entity,
      SYSTEM_PROPERTY_IDS.COMPANIES
    ),
  };
};

export type PrLinkCompany = { id: string; name: string };

export type PrLinksPage = {
  /** Links per pull request URL. */
  links: Map<string, PrLinks>;
  /** Names of the customers the links name, for the ones the viewer can see. */
  companies: Map<string, PrLinkCompany>;
};

/**
 * Agent sessions, tasks, channels, and customers linked to up to 100 pull
 * requests, with each pull request's priority.
 */
export async function fetchPrLinks(
  pullRequests: readonly PrLinksTarget[]
): Promise<PrLinksPage> {
  const [sessionsResponse, tasksResponse] = await Promise.all([
    throwOnErr(() =>
      agentHarnessServiceClient.sessionsForPullRequests(
        pullRequests.map((pullRequest) => pullRequest.url)
      )
    ),
    throwOnErr(() =>
      storageServiceClient.getGithubPullRequestTasks({
        githubKeys: pullRequests.map((pullRequest) => pullRequest.githubKey),
      })
    ),
  ]);

  const sessionsByUrl = new Map<string, PrLinkSession[]>(
    sessionsResponse.pullRequests.map((pullRequest) => [
      pullRequest.url,
      pullRequest.sessions.map((session) => ({
        id: session.sessionId,
        source: session.source,
        parent: sessionParent(session.threadParent),
      })),
    ])
  );
  const taskIdsByKey = new Map<string, string[]>(
    tasksResponse.pullRequests.map((pullRequest) => [
      pullRequest.githubKey,
      pullRequest.taskIds,
    ])
  );
  // A session started from a task's thread links that task too.
  const taskIdsFor = (pullRequest: PrLinksTarget) => [
    ...new Set([
      ...(taskIdsByKey.get(pullRequest.githubKey) ?? []),
      ...(sessionsByUrl.get(pullRequest.url) ?? []).flatMap((session) =>
        session.parent?.type === 'document' ? [session.parent.id] : []
      ),
    ]),
  ];

  const taskIds = [...new Set(pullRequests.flatMap(taskIdsFor))];
  const tasks = new Map(
    (await fetchSoupEntitiesById('df', taskIds)).flatMap((entity) => {
      const task = toLinkTask(entity);
      return task ? [[task.id, task] as const] : [];
    })
  );

  const links = new Map(
    pullRequests.map((pullRequest) => [
      pullRequest.url,
      buildPrLinks({
        sessions: sessionsByUrl.get(pullRequest.url) ?? [],
        tasks: taskIdsFor(pullRequest).flatMap((id) => tasks.get(id) ?? []),
        labels: pullRequest.labels,
      }),
    ])
  );

  const companyIds = [
    ...new Set([...links.values()].flatMap((link) => link.companyIds)),
  ];
  const companies = new Map(
    (await fetchSoupEntitiesById('ccf', companyIds)).map((entity) => [
      entity.id,
      { id: entity.id, name: entity.name },
    ])
  );
  // Customers the viewer cannot see are not shown.
  for (const link of links.values())
    link.companyIds = link.companyIds.filter((id) => companies.has(id));

  return { links, companies };
}

const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  );

/**
 * Links for each pull request, fetched one page-sized chunk at a time so a
 * list that loads another page reuses the earlier chunks' cache entries.
 */
export function usePrLinksQuery(
  pullRequests: Accessor<readonly PrLinksTarget[]>
) {
  const chunks = createMemo(() => chunk(pullRequests(), LINKS_CHUNK_SIZE));
  const queries = useQueries(() => ({
    queries: chunks().map((pullRequests) => ({
      queryKey: agentSessionPullRequestKeys.linksForPullRequests(
        pullRequests.map((pullRequest) => pullRequest.url)
      ).queryKey,
      queryFn: () => fetchPrLinks(pullRequests),
      staleTime: LINKS_STALE_TIME,
    })),
  }));

  const page = createMemo<PrLinksPage>(() => {
    const links = new Map<string, PrLinks>();
    const companies = new Map<string, PrLinkCompany>();
    for (const query of queries) {
      if (!query.isSuccess) continue;
      for (const [url, link] of query.data.links) links.set(url, link);
      for (const [id, company] of query.data.companies)
        companies.set(id, company);
    }
    return { links, companies };
  });

  return {
    /** Links for the pull request at `url`, or `undefined` while they load. */
    linksFor: (url: string): PrLinks | undefined => page().links.get(url),
    companyName: (id: string) => page().companies.get(id)?.name,
    isLoading: () => queries.some((query) => query.isPending),
    isError: () => queries.some((query) => query.isError),
    retry: () =>
      Promise.all(
        queries.filter((query) => query.isError).map((query) => query.refetch())
      ),
  };
}
