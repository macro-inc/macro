import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/host/types';
import { revalidateActivityQueries } from '@queries/activity/push-registry';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import {
  createGraphqlBulkSaveEntityPropertiesMutation,
  refetchGraphqlInitiativeProperties,
} from '@queries/properties/graphql/entity';
import { propertiesKeys } from '@queries/properties/keys';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import type { initiativeClient } from '@service-storage/initiative';
import { type QueryClient, useMutation } from '@tanstack/solid-query';
import { type Client, CombinedError } from '@urql/core';
import type { Accessor } from 'solid-js';
import type { ProjectsContext } from '../context/projects-context';
import { assignProjectTasks } from '../core/assignment';
import { createProjectMutation } from './create-project';
import { createProjectTaskMutation } from './create-project-task';
import { projectKeys } from './keys';
import { createProjectDetailQuery } from './project-identity';
import { projectDefinitionProperties } from './project-properties';
import { createProjectReferences } from './project-references';
import { createProjectSoupSource } from './project-soup';

type ProjectCommands = ReturnType<ProjectsContext['createCommands']>;

const accessLost = (error: unknown) =>
  ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].some(
    (code) =>
      thrownResultErrorHasCode(error, code) ||
      (error instanceof CombinedError &&
        error.graphQLErrors.some((error) => error.extensions.code === code))
  );

/** GraphQL Soup lists projects and holds the optimistic rows of their tasks. */
export type ProjectSoupTransport = {
  client(): Client;
  cacheHost(): CacheHost | undefined;
};

/** Transport and cache mechanics stay outside the feature's reactive consumers. */
export function createProjectSources(
  client: typeof initiativeClient,
  soup: ProjectSoupTransport,
  cache: QueryClient,
  userId: Accessor<string | undefined>,
  createReadGate: () => Accessor<boolean> = () => () => true
): ProjectsContext {
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: projectKeys._def }),
      refreshActiveGraphqlSoupQueries(),
      revalidateActivityQueries(soup.client(), null),
    ]);
  };
  const context: ProjectsContext = {
    userId,
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
        soup.client,
        filters,
        () => Boolean(userId()) && readEnabled() && enabled()
      );
    },
    createProjectSource(id) {
      const readEnabled = createReadGate();
      const query = createProjectDetailQuery(
        soup.client,
        cache,
        userId,
        id,
        readEnabled
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
    createReferencesSource(ids) {
      const readEnabled = createReadGate();
      return createProjectReferences(
        soup.client,
        cache,
        userId,
        ids,
        () => readEnabled() && Boolean(userId())
      );
    },
    createCommands() {
      const createTask = createProjectTaskMutation(
        client,
        soup.cacheHost,
        cache,
        userId,
        async () => {
          await Promise.all([
            refresh(),
            cache.invalidateQueries({ queryKey: soupKeys._def }),
          ]);
        }
      );
      const create = createProjectMutation(
        client,
        cache,
        userId,
        soup.cacheHost
      );
      const update = useMutation(
        () => ({
          mutationFn: ({
            id,
            ...body
          }: {
            id: string;
            name?: string;
            memberIds?: string[];
          }) => throwOnErr(() => client.update(id, body)),
          onSuccess: refresh,
        }),
        () => cache
      );
      // Deletes resolve with their failures so a batch refreshes the list once.
      const remove = useMutation(
        () => ({
          mutationFn: async (ids: readonly string[]) => {
            const failures: { id: string; error: unknown }[] = [];
            await Promise.all(
              ids.map(async (id) => {
                try {
                  await throwOnErr(() => client.delete(id));
                } catch (error) {
                  failures.push({ id, error });
                }
              })
            );
            return failures;
          },
          onSuccess: async (failures, ids) => {
            if (failures.length < ids.length) await refresh();
          },
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
      const saveProperties: ProjectCommands['saveProperties'] = async (
        updates
      ) => {
        const result = await property.mutateAsync({
          properties: updates.map(({ id, property, value }) => ({
            entityType: 'INITIATIVE',
            entityId: id,
            property,
            apiValues: value,
          })),
        });
        if (result.error) throw result.error;
      };
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
        setMembers: async (id, memberIds) => {
          await update.mutateAsync({ id, memberIds });
        },
        delete: async (id) => {
          const [failure] = await remove.mutateAsync([id]);
          if (failure) throw failure.error;
        },
        deleteMany: async (ids) =>
          (await remove.mutateAsync(ids)).map(({ id }) => id),
        saveProperty: (id, property, value) =>
          saveProperties([{ id, property, value }]),
        saveProperties,
        assignTasks: (projectId, taskIds) =>
          assign.mutateAsync({ projectId, taskIds }),
      };
    },
  };
  return context;
}
