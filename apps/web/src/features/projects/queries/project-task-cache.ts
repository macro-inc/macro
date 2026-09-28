import { taskMembershipScope } from '@app/features/tasks-view/queries/task-membership';
import type { createTaskWithProperties } from '@block-md/util/taskComposerProperties';
import type { CacheHost } from '@graphql-cache/host/types';
import type { Property } from '@property/types';
import { apiValuesToGraphqlPropertyValue } from '@queries/properties/graphql-optimistic';
import {
  makeGraphqlGroupedSoupInput,
  makeGraphqlSoupInput,
} from '@queries/soup/graphql/ast';
import { computeGroupKeysForItem } from '@queries/soup/grouped/api';
import type {
  SoupAstItemsPage,
  SoupAstItemsQueryArgs,
} from '@queries/soup/items';
import { soupKeys } from '@queries/soup/keys';
import {
  insertGroupedPage,
  removeGroupedPage,
} from '@queries/soup/normalized-cache/grouped-operations';
import {
  GroupSoupDocument,
  type GroupSoupQuery,
  SoupDocument,
  type SoupItemFieldsFragment,
  type SoupQuery,
} from '@service-storage/graphql/generated/graphql';
import { mapGraphqlSoupItem } from '@service-storage/graphql-soup';
import {
  hashKey,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/solid-query';
import { stringifyDocument } from '@urql/core';
import type { ProjectDetail } from '../core/project';
import { projectKeys } from './keys';

export type ProjectTaskDraft = Parameters<typeof createTaskWithProperties>;
type TaskRecord = Extract<
  SoupItemFieldsFragment,
  { __typename: 'GraphqlSoupDocument' }
>;
type DetailData = { project: ProjectDetail; properties: Property[] };

/** The same complete task record is written to either Soup transport's cache. */
export function optimisticProjectTask(
  id: string,
  ownerId: string,
  [title, , values, definitions]: ProjectTaskDraft
): TaskRecord {
  const now = new Date().toISOString();
  return {
    __typename: 'GraphqlSoupDocument',
    id,
    entityType: 'DOCUMENT',
    documentName: title,
    displayName: title,
    ownerId,
    fileType: 'md',
    createdAt: now,
    updatedAt: now,
    viewedAt: null,
    deletedAt: null,
    projectId: null,
    cacheProjection: null,
    frecencyScore: 0,
    isFavorited: false,
    notifications: [],
    subType: { __typename: 'GraphqlTaskSubType', isCompleted: false },
    properties: values.flatMap(([definitionId, value]) => {
      const definition = definitions.get(definitionId);
      if (!definition) return [];
      const metadata =
        'data_type' in definition
          ? {
              displayName: definition.display_name,
              dataType: definition.data_type,
              isMultiSelect: definition.is_multi_select,
              isSystem: definition.is_system,
              isMetadata: definition.is_metadata,
              specificEntityType: definition.specific_entity_type ?? null,
            }
          : {
              displayName: definition.displayName,
              dataType: definition.dataType,
              isMultiSelect: definition.isMultiSelect,
              isSystem: definition.isSystem,
              isMetadata: definition.isMetadata,
              specificEntityType: definition.specificEntityType ?? null,
            };
      return [
        {
          id: `${id}:${definitionId}`,
          propertyDefinitionId: definitionId,
          ...metadata,
          value: apiValuesToGraphqlPropertyValue(value),
        },
      ];
    }),
  };
}

/** Seed the next membership query before publishing its task IDs to readers. */
export async function updateProjectTaskCache(
  cache: QueryClient,
  host:
    | Pick<CacheHost, 'disabled' | 'readQuery' | 'writeQuery' | 'deleteRecords'>
    | undefined,
  userId: string,
  projectId: string,
  removeId?: string,
  task?: TaskRecord
) {
  const detailKey = projectKeys.detail(userId, projectId).queryKey;
  await cache.cancelQueries({ queryKey: detailKey, exact: true });
  const detail = cache.getQueryData<DetailData>(detailKey);
  if (!detail) return;
  const previousIds = detail.project.taskIds;
  const nextIds = [
    ...new Set([
      ...previousIds.filter((id) => id !== removeId),
      ...(task ? [task.id] : []),
    ]),
  ];
  const previousScope = hashKey([taskMembershipScope(previousIds)]);
  const candidate = task ? mapGraphqlSoupItem(task) : undefined;
  const removeIds = new Set(removeId ? [removeId] : []);
  const queries = cache
    .getQueryCache()
    .findAll({ queryKey: soupKeys.astItems._def });
  for (const query of queries) {
    const [, , params, body, groupBy, transport] = query.queryKey as ReturnType<
      typeof soupKeys.astItems
    >['queryKey'];
    const df = body.df as ReturnType<typeof taskMembershipScope> | undefined;
    if (!df || !('&' in df) || hashKey([df['&'][1]]) !== previousScope)
      continue;
    const insertFilter = query.meta?.insertFilter;
    const item =
      candidate &&
      (typeof insertFilter !== 'function' || insertFilter(candidate))
        ? candidate
        : undefined;
    const targetGroups = item
      ? groupBy?.type === 'date'
        ? ['today']
        : (computeGroupKeysForItem(item, groupBy) ?? [])
      : [];
    const previousArgs = { params, body, groupBy, transport };
    const nextArgs: SoupAstItemsQueryArgs = {
      ...previousArgs,
      body: {
        ...body,
        df: { '&': [df['&'][0], taskMembershipScope(nextIds)] },
      },
    };
    await cache.cancelQueries({ queryKey: query.queryKey, exact: true });
    const previous = cache.getQueryData<InfiniteData<SoupAstItemsPage>>(
      query.queryKey
    ) ?? {
      pageParams: [null],
      pages: [
        groupBy
          ? {
              kind: 'grouped' as const,
              items: {},
              groups: [],
              nextCursor: null,
            }
          : { kind: 'flat' as const, items: [], nextCursor: null },
      ],
    };
    if (previous) {
      const next: InfiniteData<SoupAstItemsPage> = {
        ...previous,
        pages: previous.pages.map((page, index) => {
          if (page.kind === 'flat')
            return {
              ...page,
              items: [
                ...(index === 0 && item ? [item] : []),
                ...page.items.filter(
                  (row) =>
                    row.tag !== 'document' ||
                    (!removeIds.has(row.data.id) && row.data.id !== task?.id)
                ),
              ],
            };
          const remaining = removeGroupedPage(page, removeIds);
          if (index !== 0 || !item || !task) return remaining;
          const inserted = insertGroupedPage(remaining, item, task.id, groupBy);
          if (inserted) return inserted;
          // New tasks have a known creation/update date. Assignee labels are
          // resolved by the standard task group header from the group key.
          const groups = remaining.groups.map((group) =>
            targetGroups.includes(group.key) && !group.itemIds.includes(task.id)
              ? {
                  ...group,
                  itemIds: [task.id, ...group.itemIds],
                  totalCount: group.totalCount + 1,
                }
              : group
          );
          for (const key of targetGroups) {
            if (!groups.some((group) => group.key === key))
              groups.push({
                key,
                label: groupBy?.type === 'date' ? 'Today' : key,
                displayOrder: null,
                itemIds: [task.id],
                totalCount: 1,
                nextCursor: null,
              });
          }
          return {
            ...remaining,
            items: { ...remaining.items, [task.id]: item },
            groups,
          };
        }),
      };
      cache.setQueryData(query.queryKey, next);
      cache.setQueryData(soupKeys.astItems(nextArgs).queryKey, next);
    }
    if (!host || host.disabled) continue;
    if (groupBy) {
      const queryText = stringifyDocument(GroupSoupDocument);
      const oldInput = makeGraphqlGroupedSoupInput({
        ...previousArgs,
        groupBy,
      });
      const input = makeGraphqlGroupedSoupInput({ ...nextArgs, groupBy });
      const read = await host.readQuery({
        query: queryText,
        operationName: 'GroupSoup',
        variables: { input: oldInput },
        priority: 'user-visible',
      });
      const data: GroupSoupQuery =
        read.kind === 'hit'
          ? (read.data as GroupSoupQuery)
          : { user: { id: userId, groupSoup: { bins: [] } } };
      const bins = data.user.groupSoup.bins.map((bin) => {
        const items = bin.items.filter(
          (row) => !removeIds.has(row.id) && row.id !== task?.id
        );
        return {
          ...bin,
          items,
          totalCount: Math.max(
            0,
            bin.totalCount - (bin.items.length - items.length)
          ),
        };
      });
      for (const key of targetGroups) {
        const bin = bins.find((bin) => bin.key === key);
        if (bin) {
          bin.items = [task!, ...bin.items];
          bin.totalCount += 1;
        } else
          bins.unshift({
            key,
            items: [task!],
            totalCount: 1,
            nextCursor: null,
          });
      }
      // Keep the old ID readable until observers switch to the seeded new key.
      // The membership filter admits only one of these IDs at either point.
      const previousBins = data.user.groupSoup.bins.map((bin) => ({
        ...bin,
        items: [...bin.items],
      }));
      for (const key of targetGroups) {
        const bin = previousBins.find((bin) => bin.key === key);
        if (bin && !bin.items.some((row) => row.id === task!.id)) {
          bin.items.unshift(task!);
          bin.totalCount++;
        } else if (!bin)
          previousBins.unshift({
            key,
            items: [task!],
            totalCount: 1,
            nextCursor: null,
          });
      }
      await host.writeQuery({
        query: queryText,
        operationName: 'GroupSoup',
        variables: { input: oldInput },
        data: {
          ...data,
          user: { ...data.user, groupSoup: { bins: previousBins } },
        } satisfies GroupSoupQuery,
      });
      await host.writeQuery({
        query: queryText,
        operationName: 'GroupSoup',
        variables: { input },
        data: {
          ...data,
          user: { ...data.user, groupSoup: { ...data.user.groupSoup, bins } },
        } satisfies GroupSoupQuery,
      });
    } else {
      const queryText = stringifyDocument(SoupDocument);
      const read = await host.readQuery({
        query: queryText,
        operationName: 'Soup',
        variables: { input: makeGraphqlSoupInput(previousArgs) },
        priority: 'user-visible',
      });
      const data: SoupQuery =
        read.kind === 'hit'
          ? (read.data as SoupQuery)
          : {
              user: {
                id: userId,
                emailLinks: [],
                soup: { items: [], nextCursor: null },
              },
            };
      await host.writeQuery({
        query: queryText,
        operationName: 'Soup',
        variables: { input: makeGraphqlSoupInput(previousArgs) },
        data: {
          ...data,
          user: {
            ...data.user,
            soup: {
              ...data.user.soup,
              items: [
                ...(item && task ? [task] : []),
                ...data.user.soup.items.filter((row) => row.id !== task?.id),
              ],
            },
          },
        } satisfies SoupQuery,
      });

      await host.writeQuery({
        query: queryText,
        operationName: 'Soup',
        variables: { input: makeGraphqlSoupInput(nextArgs) },
        data: {
          ...data,
          user: {
            ...data.user,
            soup: {
              ...data.user.soup,
              items: [
                ...(item && task ? [task] : []),
                ...data.user.soup.items.filter(
                  (row) => !removeIds.has(row.id) && row.id !== task?.id
                ),
              ],
            },
          },
        } satisfies SoupQuery,
      });
    }
  }
  // Lists no longer hold the optimistic record, but Quick Access would.
  if (removeId && host && !host.disabled)
    await host.deleteRecords([`GraphqlSoupDocument:${removeId}`]);
  cache.setQueryData<DetailData>(detailKey, (current) =>
    current
      ? {
          ...current,
          project: { ...current.project, taskIds: nextIds },
        }
      : current
  );
}
