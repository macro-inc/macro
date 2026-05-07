import { ENABLE_PROJECT_SHARING } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { compareDateDesc } from '@core/util/date';
import { isOk } from '@core/util/maybeResult';
import {
  refetchHistory,
  useUpsertToHistoryMutation,
} from '@queries/history/history';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { storageServiceClient } from '@service-storage/client';
import type { Project } from '@service-storage/generated/schemas/project';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { v4 as uuidv4 } from 'uuid';
import { queryClient } from '../client';
import { storageKeys } from './keys';

const PROJECTS_STALE_TIME = 5 * 60 * 1000;
const PROJECTS_GC_TIME = 10 * 60 * 1000;

type ProjectsQueryResponse = {
  projects: Project[];
  pending: Project[];
};

async function fetchProjects(): Promise<ProjectsQueryResponse> {
  const [projectsResult, pendingResult] = await Promise.all([
    storageServiceClient.projects.getAll(),
    storageServiceClient.projects.getPending(),
  ]);

  const projects = isOk(projectsResult) ? projectsResult[1].data : [];
  const pending = isOk(pendingResult) ? pendingResult[1].data : [];

  return { projects, pending };
}

function projectsQueryOptions() {
  return {
    queryKey: storageKeys.projects.list.queryKey,
    queryFn: fetchProjects,
    staleTime: PROJECTS_STALE_TIME,
    gcTime: PROJECTS_GC_TIME,
  };
}

function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) =>
    compareDateDesc(a.createdAt, b.createdAt)
  );
}

function filterByUserId(
  projects: Project[],
  userId: string | undefined
): Project[] {
  if (!userId) return projects;
  return projects.filter((project) => project.userId === userId);
}

export function useProjectsQuery() {
  const userId = useUserId();

  return useQuery(() => ({
    ...projectsQueryOptions(),
    placeholderData: (prev) => prev,
    select: (data: ProjectsQueryResponse): Project[] => {
      const allProjects = [...data.projects, ...data.pending];
      const sorted = sortProjects(allProjects);

      if (!ENABLE_PROJECT_SHARING) {
        return filterByUserId(sorted, userId());
      }

      return sorted;
    },
  }));
}

export function invalidateProjects() {
  return queryClient.invalidateQueries({
    queryKey: storageKeys.projects.list.queryKey,
  });
}

/**
 * Standalone function for creating projects that can be used outside of component context.
 * Prefer `useCreateProjectMutation` when inside a component.
 */
export async function createProject(params: {
  name: string;
  parentId?: string;
  sharePermission?: null;
}): Promise<string | undefined> {
  const maybeResult = await storageServiceClient.projects.create({
    name: params.name,
    projectParentId: params.parentId,
    sharePermission: params.sharePermission,
  });

  if (isOk(maybeResult)) {
    const projectId = maybeResult[1].id;
    setPreviewOnCreate({
      itemId: projectId,
      itemType: 'project',
      name: params.name,
    });
    await storageServiceClient.upsertItemToUserHistory({
      itemId: projectId,
      itemType: 'project',
    });
    await Promise.all([invalidateProjects(), refetchHistory()]);
    return projectId;
  }

  return undefined;
}

type CreateProjectParams = {
  name: string;
  parentId?: string;
  sharePermission?: null;
};

type CreateProjectContext = {
  previousData: ProjectsQueryResponse | undefined;
  tempProjectId: string;
};

export function useCreateProjectMutation(
  callbacks?: MutationCallbacks<
    string | undefined,
    Error,
    CreateProjectParams,
    CreateProjectContext
  >
) {
  const upsertToHistoryMutation = useUpsertToHistoryMutation();

  return useMutation(() => ({
    mutationFn: async (
      params: CreateProjectParams
    ): Promise<string | undefined> => {
      const maybeResult = await storageServiceClient.projects.create({
        name: params.name,
        projectParentId: params.parentId,
        sharePermission: params.sharePermission,
      });

      if (isOk(maybeResult)) {
        return maybeResult[1].id;
      }
      return undefined;
    },
    ...withCallbacks<
      string | undefined,
      Error,
      CreateProjectParams,
      CreateProjectContext
    >(
      {
        onMutate: async (params) => {
          await queryClient.cancelQueries({
            queryKey: storageKeys.projects.list.queryKey,
          });

          const previousData = queryClient.getQueryData<ProjectsQueryResponse>(
            storageKeys.projects.list.queryKey
          );

          const tempProjectId = uuidv4();
          const tempProject: Project = {
            createdAt: new Date().toISOString(),
            id: tempProjectId,
            name: params.name,
            parentId: params.parentId,
            type: 'project',
            userId: '',
            updatedAt: new Date().toISOString(),
            deletedAt: null,
          };

          queryClient.setQueryData<ProjectsQueryResponse>(
            storageKeys.projects.list.queryKey,
            (old) => {
              if (!old) return { projects: [tempProject], pending: [] };
              return {
                ...old,
                projects: [tempProject, ...old.projects],
              };
            }
          );

          return { previousData, tempProjectId };
        },
        onSuccess: (projectId, params, _context) => {
          if (projectId) {
            setPreviewOnCreate({
              itemId: projectId,
              itemType: 'project',
              name: params.name,
            });
            upsertToHistoryMutation.mutate({
              itemId: projectId,
              itemType: 'project',
            });
          }
        },
        onError: (_err, _params, context) => {
          if (context?.previousData) {
            queryClient.setQueryData(
              storageKeys.projects.list.queryKey,
              context.previousData
            );
          }
        },
        onSettled: () => {
          queryClient.invalidateQueries({
            queryKey: storageKeys.projects.list.queryKey,
          });
          refetchHistory();
        },
      },
      callbacks
    ),
  }));
}
