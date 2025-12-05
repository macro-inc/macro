import { ENABLE_PROJECT_SHARING } from '@core/constant/featureFlags';
import { isOk, ok } from '@core/util/maybeResult';
import { useUserId } from '@service-gql/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createResource } from 'solid-js';
import { v4 as uuidv4 } from 'uuid';
import { storageServiceClient } from './client';
import type { Project } from './generated/schemas/project';
import { UploadDocumentStatus } from './generated/schemas/uploadDocumentStatus';
import { postNewHistoryItem } from './history';

/**
 * @internal Don't use this directly
 */
const projectsResource = createSingletonRoot(() =>
  createResource(storageServiceClient.projects.getAll, {
    initialValue: ok({ data: [] }),
  })
);

const pendingProjectsResource = createSingletonRoot(() =>
  createResource(storageServiceClient.projects.getPending, {
    initialValue: ok({ data: [] }),
  })
);

const projectContentResource = createSingletonRoot(
  () => new Map<string, ReturnType<typeof createProjectContentResource>>()
);

export function useIsPendingProject() {
  const [resource] = pendingProjectsResource();

  const pendingProjectIdSet = createMemo((): Set<string> => {
    const [err, result] = resource.latest;
    if (err || resource.error) return new Set();

    const data = result.data;
    let pendingProjectIds: string[] = [];
    for (const project of data) {
      const projectId = project.id;
      // NOTE: there can be a race condition where the documents are marked
      // as completed before the project is marked as pending so we handle here
      const hasPendingDocument = project.documentStatuses.some(
        (status) => status.status !== UploadDocumentStatus.completed
      );
      if (hasPendingDocument) {
        pendingProjectIds.push(projectId);
      }
    }

    return new Set(pendingProjectIds);
  });

  return (projectId: string) => {
    return pendingProjectIdSet().has(projectId);
  };
}

export function useIsPendingDocument() {
  const [resource] = pendingProjectsResource();

  const pendingDocumentIdSet = createMemo((): Set<string> => {
    const [err, result] = resource.latest;
    if (err || resource.error) return new Set();

    const data = result.data;
    return new Set(
      data.flatMap((project) =>
        project.documentStatuses
          .filter((s) => s.status !== UploadDocumentStatus.pending)
          .map((s) => s.documentId)
      )
    );
  });

  return (documentId: string) => {
    return pendingDocumentIdSet().has(documentId);
  };
}

export function useProjects() {
  const [resource] = projectsResource();
  const [pendingResource] = pendingProjectsResource();
  const userId = useUserId();
  return createMemo((prev: Project[]) => {
    const [err, projectResult] = resource.latest;
    const projectData = err || resource.error ? [] : projectResult.data;

    const [pendingErr, pendingResult] = pendingResource.latest;
    const pendingData =
      pendingErr || pendingResource.error ? [] : pendingResult.data;

    const allProjects: Project[] = [...projectData, ...pendingData];

    const sortedByCreatedAt = allProjects.sort(
      (a, b) => b.createdAt - a.createdAt
    );

    if (!ENABLE_PROJECT_SHARING) {
      const _userId = userId();
      return sortedByCreatedAt.filter((project) => project.userId === _userId);
    }

    if (prev.length !== sortedByCreatedAt.length) return sortedByCreatedAt;

    /*
     * This is naive looking however other methods were freezing the server on
     * reloads
     */
    const validateSameData = (a: Project, b: Project) => {
      if (a.id !== b.id) return false;
      if (a.name !== b.name) return false;
      if (a.parentId !== b.parentId) return false;
      if (a.type !== b.type) return false;
      if (a.userId !== b.userId) return false;
      if (a.createdAt !== b.createdAt) return false;
      if (a.updatedAt !== b.updatedAt) return false;
      return true;
    };

    const noDiff = sortedByCreatedAt.every((project) =>
      prev.some((prevProject) => validateSameData(project, prevProject))
    );

    if (noDiff) return prev;

    return sortedByCreatedAt;
  }, []);
}

export async function refetchProjects(force = false) {
  const [resource, { refetch }] = projectsResource();
  const [pendingResource, { refetch: pendingRefetch }] =
    pendingProjectsResource();

  if (force || (!resource.loading && !pendingResource.loading)) {
    await Promise.allSettled([refetch(), pendingRefetch()]);
    return;
  }

  if (resource.loading) {
    await pendingRefetch();
  } else if (pendingResource.loading) {
    await refetch();
  }
}

export function useCreateProject() {
  const [resource, { mutate }] = projectsResource();
  return async ({
    name,
    parentId,
    sharePermission,
  }: {
    name: string;
    parentId?: string;
    sharePermission?: null;
  }) => {
    const [err, result] = resource.latest;
    if (err) return;

    // Create temporary project for optimistic update
    // TODO: this should optimistically update the file tree, not the projectsResource
    const tempProject: Project = {
      createdAt: Date.now(),
      id: uuidv4(), // temporary ID
      name: name,
      parentId: parentId ?? undefined,
      type: 'project',
      userId: '',
      updatedAt: Date.now(),
    };

    // Optimistic update
    mutate(
      ok({
        data: [tempProject, ...result.data],
      })
    );

    const maybeResult = await storageServiceClient.projects.create({
      name,
      projectParentId: parentId,
      sharePermission,
    });

    if (isOk(maybeResult)) {
      postNewHistoryItem('project', maybeResult[1].id);
      return maybeResult[1].id;
    }
  };
}

const createProjectContentResource = (projectId: string) => {
  return createResource(
    () => {
      if (!projectId) return;
      return { id: projectId };
    },
    storageServiceClient.projects.getContent,
    { initialValue: ok({ data: [], error: false }) }
  );
};

export function refetchAllProjectContent(force = false) {
  const resources = projectContentResource();
  for (const [, resource] of resources) {
    const [, { refetch }] = resource;
    if (force) {
      refetch();
      continue;
    }
    if (!resource[0].loading) {
      refetch();
    }
  }
}

// Utility functions for gathering project children ids
export const getAllChildProjectIds = (
  projectId: string,
  projects?: Project[]
): string[] => {
  if (!projects) projects = useProjects()();

  const directChildren = projects.filter(
    (project) => project.parentId === projectId
  );

  if (!directChildren) {
    return [];
  }

  const directChildrenIds = directChildren.map((project) => project.id);

  const allChildIds = directChildrenIds.flatMap((projectId) =>
    getAllChildProjectIds(projectId)
  );

  return [...directChildrenIds, ...allChildIds];
};

// Utility functions for gathering non-child project ids
export const getAllParentSiblingProjectIds = (
  projecId: string,
  projects?: Project[]
) => {
  if (!projects) projects = useProjects()();
  const childrenIds = getAllChildProjectIds(projecId);
  const excludeIds = [projecId, ...childrenIds];

  return projects
    .filter((project) => !excludeIds.includes(project.id))
    .map((project) => project.id);
};
