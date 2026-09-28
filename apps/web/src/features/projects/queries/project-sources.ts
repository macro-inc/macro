import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import type { TaskEntityWithProperties } from '@entity';
import { soupPropertyToProperty } from '@entity/extractors-property/property-helpers';
import { withProjectStatusOptions } from '@property/utils/select-options';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import {
  createGraphqlBulkSaveEntityPropertiesMutation,
  refetchGraphqlInitiativeProperties,
} from '@queries/properties/graphql/entity';
import { propertiesKeys } from '@queries/properties/keys';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import type { initiativeClient } from '@service-storage/initiative';
import {
  type QueryClient,
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { ProjectsContext } from '../context/projects-context';
import { assignProjectTasks } from '../core/assignment';
import type {
  ProjectDetail,
  ProjectSharingPatch,
  TaskProjectReference,
} from '../core/project';
import { createProjectTaskMutation } from './create-project-task';
import { projectKeys } from './keys';
import { createProjectChannelNamesSource } from './project-channel-names';
import { toProjectDetail } from './project-model';
import {
  PROJECT_PROPERTY_IDS,
  projectDefinitionProperties,
} from './project-properties';
import { createProjectSoupSource } from './project-soup';
import type { ProjectTaskRefreshSource } from './project-task-revalidation';

const projectProperties = (properties: SoupProperty[]) =>
  properties
    .filter((property) => PROJECT_PROPERTY_IDS.includes(property.definition.id))
    .map(soupPropertyToProperty)
    .map(withProjectStatusOptions)
    .sort(
      (left, right) =>
        PROJECT_PROPERTY_IDS.indexOf(left.propertyDefinitionId) -
        PROJECT_PROPERTY_IDS.indexOf(right.propertyDefinitionId)
    );

const accessLost = (error: unknown) =>
  ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].some((code) =>
    thrownResultErrorHasCode(error, code)
  );

/** Transport and cache mechanics stay outside the feature's reactive consumers. */
export function createProjectSources(
  client: typeof initiativeClient,
  cache: QueryClient,
  userId: Accessor<string | undefined>,
  observeTaskChanges: (source: ProjectTaskRefreshSource) => void,
  hydrateTasks: (
    taskIds: string[],
    signal: AbortSignal
  ) => Promise<TaskEntityWithProperties[]>,
  createReadGate: () => Accessor<boolean> = () => () => true
): ProjectsContext {
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: projectKeys._def }),
      refreshActiveGraphqlSoupQueries(),
    ]);
  };
  const context: ProjectsContext = {
    userId,
    createChannelNamesSource: createProjectChannelNamesSource,
    createPropertyDefinitionsSource() {
      const definitions = useListPropertiesQuery(() => ({
        scope: 'system',
        includeOptions: true,
      }));
      return {
        loading: () => definitions.isPending,
        error: () => definitions.error ?? undefined,
        properties: () =>
          definitions.isPending
            ? []
            : projectDefinitionProperties(definitions.data ?? []),
      };
    },
    createCollectionSource(filters = () => ({}), enabled = () => true) {
      const readEnabled = createReadGate();
      return createProjectSoupSource(
        filters,
        () => Boolean(userId()) && readEnabled() && enabled()
      );
    },
    createProjectSource(id) {
      const readEnabled = createReadGate();
      const creating = useIsMutating(
        () => ({ mutationKey: projectKeys.createTask._def }),
        () => cache
      );
      const query = useQuery(
        () => {
          const projectId = id();
          return {
            queryKey: projectKeys.detail(userId(), projectId).queryKey,
            enabled:
              readEnabled() && Boolean(userId() && projectId) && !creating(),
            queryFn: async ({ signal }) => {
              const project = await throwOnErr(() =>
                client.get(projectId, signal)
              );
              return {
                project: toProjectDetail(project),
                properties: projectProperties(project.properties),
              };
            },
            staleTime: 30_000,
            refetchInterval: 30_000,
            refetchOnWindowFocus: true,
          };
        },
        () => cache
      );
      return {
        project: () =>
          !readEnabled() || query.isPending || accessLost(query.error)
            ? undefined
            : query.data?.project,
        properties: () =>
          !readEnabled() || query.isPending || accessLost(query.error)
            ? []
            : (query.data?.properties ?? []),
        loading: () => readEnabled() && query.isPending,
        error: () => (readEnabled() ? (query.error ?? undefined) : undefined),
        refresh: async () => {
          if (!readEnabled()) return;
          await refresh();
        },
      };
    },
    createTasksSource(id) {
      const readEnabled = createReadGate();
      const query = useInfiniteQuery(
        () => {
          const projectId = id();
          return {
            queryKey: projectKeys.tasks(userId(), projectId).queryKey,
            enabled: readEnabled() && Boolean(userId() && projectId),
            initialPageParam: undefined as string | undefined,
            queryFn: async ({ signal, pageParam }) => {
              const page = await throwOnErr(() =>
                client.tasks(
                  projectId,
                  { cursor: pageParam, limit: 50 },
                  signal
                )
              );
              return {
                tasks: await hydrateTasks(page.taskIds, signal),
                nextCursor: page.nextCursor,
              };
            },
            getNextPageParam: (page) => page.nextCursor ?? undefined,
            staleTime: 30_000,
            refetchInterval: 30_000,
            refetchOnWindowFocus: true,
          };
        },
        () => cache
      );
      const tasks = () =>
        !readEnabled() || query.isPending || accessLost(query.error)
          ? []
          : (query.data?.pages.flatMap((page) => page.tasks) ?? []);
      observeTaskChanges({
        projectId: id,
        taskIds: () => tasks().map((task) => task.id),
        refresh: async () => {
          if (!readEnabled()) return;
          await query.refetch({ cancelRefetch: false });
        },
      });
      return {
        tasks,
        loading: () => readEnabled() && query.isPending,
        error: () => (readEnabled() ? (query.error ?? undefined) : undefined),
        hasMore: () => readEnabled() && query.hasNextPage,
        loadingMore: () => readEnabled() && query.isFetchingNextPage,
        loadMore: async () => {
          if (!readEnabled()) return;
          await query.fetchNextPage();
        },
      };
    },
    createReferencesSource(ids) {
      const readEnabled = createReadGate();
      const creating = useIsMutating(
        () => ({ mutationKey: projectKeys.createTask._def }),
        () => cache
      );
      const query = useQuery(
        () => {
          const taskIds = [...new Set(ids())].sort();
          return {
            queryKey: projectKeys.taskReferences(userId(), taskIds).queryKey,
            enabled:
              readEnabled() &&
              Boolean(userId() && taskIds.length) &&
              !creating(),
            initialData: () => {
              if (!creating()) return undefined;
              const projects = cache.getQueriesData<{
                project: ProjectDetail;
              }>({ queryKey: projectKeys.detail._def });
              const references = new Map<string, TaskProjectReference>();
              for (const taskId of taskIds) {
                const project = projects.find(([, data]) =>
                  data?.project.taskIds.includes(taskId)
                )?.[1]?.project;
                if (!project) return undefined;
                references.set(taskId, {
                  state: 'visible',
                  id: project.id,
                  name: project.name,
                });
              }
              return references;
            },
            initialDataUpdatedAt: 0,
            placeholderData: (previous) => previous,
            queryFn: async ({ signal }) => {
              const references = new Map<string, TaskProjectReference>();
              for (let offset = 0; offset < taskIds.length; offset += 100) {
                const page = await throwOnErr(() =>
                  client.taskReferences(
                    taskIds.slice(offset, offset + 100),
                    signal
                  )
                );
                for (const reference of page.references) {
                  references.set(
                    reference.taskId,
                    reference.state === 'visible' && reference.initiative
                      ? { state: 'visible', ...reference.initiative }
                      : {
                          state:
                            reference.state === 'none' ? 'none' : 'unavailable',
                        }
                  );
                }
              }
              return references;
            },
            staleTime: 30_000,
            refetchInterval: 30_000,
            refetchOnWindowFocus: true,
          };
        },
        () => cache
      );
      return {
        references: () =>
          !readEnabled() || query.isPending || accessLost(query.error)
            ? new Map()
            : (query.data ?? new Map()),
        loading: () => readEnabled() && query.isPending,
        error: () => (readEnabled() ? (query.error ?? undefined) : undefined),
      };
    },
    createCommands() {
      const createTask = createProjectTaskMutation(
        client,
        cache,
        userId,
        async () => {
          await Promise.all([
            refresh(),
            cache.invalidateQueries({ queryKey: soupKeys._def }),
          ]);
        }
      );
      const create = useMutation(
        () => ({
          mutationFn: async (input: { name: string; shareWithTeam: boolean }) =>
            toProjectDetail(await throwOnErr(() => client.create(input))),
          onSuccess: refresh,
        }),
        () => cache
      );
      const update = useMutation(
        () => ({
          mutationFn: ({
            id,
            ...body
          }: {
            id: string;
            name?: string;
            sharePermission?: ProjectSharingPatch;
            memberIds?: string[];
          }) => throwOnErr(() => client.update(id, body)),
          onSuccess: refresh,
        }),
        () => cache
      );
      const remove = useMutation(
        () => ({
          mutationFn: (id: string) => throwOnErr(() => client.delete(id)),
          onSuccess: refresh,
        }),
        () => cache
      );
      const property = createGraphqlBulkSaveEntityPropertiesMutation({
        onSuccess: async (input) => {
          await Promise.all([
            refresh(),
            ...[
              ...new Set(input.properties.map(({ entityId }) => entityId)),
            ].map(refetchGraphqlInitiativeProperties),
            ...input.properties.map(({ entityId }) =>
              cache.invalidateQueries({
                queryKey: propertiesKeys.entity({
                  entityType: 'INITIATIVE',
                  entityId,
                }).queryKey,
              })
            ),
          ]);
        },
      });
      const assign = useMutation(
        () => ({
          mutationFn: async ({
            projectId,
            taskIds,
          }: {
            projectId?: string;
            taskIds: readonly string[];
          }) => {
            return assignProjectTasks(
              {
                assign: async (projectId, batch) => {
                  const response = await throwOnErr(() =>
                    client.assignTasks(projectId, { taskIds: batch })
                  );
                  return response.results.map((result) => ({
                    taskId: result.taskId,
                    error:
                      result.status === 'notATask'
                        ? 'This item is not a task.'
                        : result.status === 'notFound'
                          ? 'Task no longer exists.'
                          : result.status === 'skippedNoPermission'
                            ? 'You need edit access to this task.'
                            : undefined,
                  }));
                },
                clear: async (taskId) => {
                  await throwOnErr(() => client.removeTask(taskId));
                },
              },
              projectId,
              taskIds
            );
          },
          onSettled: async () => {
            await Promise.all([
              refresh(),
              cache.invalidateQueries({ queryKey: soupKeys._def }),
            ]);
          },
        }),
        () => cache
      );
      return {
        createTask,
        pending: () =>
          create.isPending ||
          update.isPending ||
          remove.isPending ||
          property.isPending ||
          assign.isPending,
        create: (input) => create.mutateAsync(input),
        rename: async (id, name) => {
          await update.mutateAsync({ id, name });
        },
        share: async (id, sharePermission) => {
          await update.mutateAsync({ id, sharePermission });
        },
        setMembers: async (id, memberIds) => {
          await update.mutateAsync({ id, memberIds });
        },
        delete: async (id) => {
          await remove.mutateAsync(id);
        },
        saveProperty: async (id, input, value) => {
          const result = await property.mutateAsync({
            properties: [
              {
                entityType: 'INITIATIVE',
                entityId: id,
                property: input,
                apiValues: value,
              },
            ],
          });
          if (result.error) throw result.error;
        },
        assignTasks: (projectId, taskIds) =>
          assign.mutateAsync({ projectId, taskIds }),
      };
    },
  };
  return context;
}
