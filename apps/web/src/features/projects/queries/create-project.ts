import { throwOnErr } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/host/types';
import { propertyValueToApi } from '@property/api/converters';
import { toGraphqlSetPropertyValue } from '@queries/properties/graphql/entity';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { CreateInitiativeInput } from '@service-storage/graphql/generated/graphql';
import type { initiativeClient } from '@service-storage/initiative';
import { type QueryClient, useMutation } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { ProjectCreationInput } from '../context/projects-context';
import { captureProjectCacheScope } from './project-cache-scope';
import { seedProjectDetail } from './project-identity';
import { toProjectDetail } from './project-model';

/** The drafted values travel with the create, as a task's do. */
export function createInitiativeInput(
  input: ProjectCreationInput
): CreateInitiativeInput {
  return {
    name: input.name,
    shareWithTeam: input.shareWithTeam,
    propertyValues: input.properties.flatMap(({ property, value }) => {
      const graphqlValue = toGraphqlSetPropertyValue(
        propertyValueToApi(value, property.isMultiSelect)
      );
      // An unset value is already the server's default.
      return graphqlValue
        ? [
            {
              propertyDefinitionId: property.propertyDefinitionId,
              value: graphqlValue,
            },
          ]
        : [];
    }),
  };
}

/**
 * One request creates the project with its values. Like task creation, it
 * resolves as soon as the server answers: the response seeds the project's
 * detail, and the lists catch up in the background.
 */
export function createProjectMutation(
  client: Pick<typeof initiativeClient, 'create'>,
  cache: QueryClient,
  userId: Accessor<string | undefined>,
  cacheHost: () => CacheHost | undefined = () => undefined
) {
  return useMutation(
    () => ({
      mutationFn: async (input: ProjectCreationInput) => {
        const scope = captureProjectCacheScope(userId, cacheHost);
        try {
          const project = await throwOnErr(() =>
            client.create(createInitiativeInput(input))
          );
          if (scope.isCurrent()) {
            await seedProjectDetail(scope.viewer, project, scope.host);
            if (scope.isCurrent())
              void refetchSoupEntity(project.id, 'initiative', {
                ownTouch: true,
                refreshGraphql: true,
              });
          }
          return toProjectDetail(project);
        } finally {
          scope.dispose();
        }
      },
    }),
    () => cache
  );
}
