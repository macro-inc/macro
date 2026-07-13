import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { storageServiceClient } from '@service-storage/client';
import type { GetProjectResponseData } from '@service-storage/generated/schemas/getProjectResponseData';
import { ProjectType } from '@service-storage/generated/schemas/projectType';
import { ok } from 'neverthrow';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'project',
  description: 'View individual folders',
  component: lazy(() => import('./component/Block')),
  async load(source, _intent) {
    if (source.type === 'dss') {
      if (source.id === 'root') {
        return ok({
          projectMetadata: {
            id: 'root',
            name: 'root',
            parentId: '',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            type: ProjectType.project,
            userId: '',
            deletedAt: null,
          },
          userAccessLevel: 'owner',
        } satisfies GetProjectResponseData);
      } else if (source.id === 'trash') {
        return ok({
          projectMetadata: {
            id: 'trash',
            name: 'Trash',
            parentId: '',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            type: ProjectType.project,
            userId: '',
            deletedAt: null,
          },
          userAccessLevel: 'owner',
        } satisfies GetProjectResponseData);
      }
      const maybeProject = await loadResult(
        storageServiceClient.projects.getProject({ id: source.id })
      );
      if (maybeProject.isErr()) {
        return maybeProject;
      }
      const project = maybeProject.value;

      return ok(project);
    }

    return LoadErrors.MISSING;
  },
  accepted: {},
  editPermissionEnabled: true,
});

export type ProjectData = ExtractLoadType<(typeof definition)['load']>;
