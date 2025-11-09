import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { isErr, ok } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import type { GetProjectResponseData } from '@service-storage/generated/schemas/getProjectResponseData';
import { ProjectType } from '@service-storage/generated/schemas/projectType';
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
            createdAt: 0,
            updatedAt: 0,
            type: ProjectType.project,
            userId: '',
          },
          userAccessLevel: 'owner',
        } satisfies GetProjectResponseData);
      } else if (source.id === 'trash') {
        return ok({
          projectMetadata: {
            id: 'trash',
            name: 'Trash',
            parentId: '',
            createdAt: 0,
            updatedAt: 0,
            type: ProjectType.project,
            userId: '',
          },
          userAccessLevel: 'owner',
        } satisfies GetProjectResponseData);
      }
      const maybeProject = await loadResult(
        storageServiceClient.projects.getProject({ id: source.id })
      );
      if (isErr(maybeProject)) {
        return maybeProject;
      }
      const [, project] = maybeProject;

      return ok(project);
    }

    return LoadErrors.MISSING;
  },
  accepted: {},
  editPermissionEnabled: true,
});

export type ProjectData = ExtractLoadType<(typeof definition)['load']>;
