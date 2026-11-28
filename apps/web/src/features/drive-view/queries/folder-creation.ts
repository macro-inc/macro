import { fireAndForget } from '@core/util/fireAndForget';
import { uploadFiles } from '@core/util/upload';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import { refetchHistory } from '@queries/history/history';
import { saveCreatedEntityTags } from '@queries/properties/graphql/created-entity-tags';
import { refetchSoupEntity } from '@queries/soup/cache';
import { createProject } from '@queries/storage/projects';
import type { FolderCreationCommands } from '../core/folder-composer';

const reportRefetchError = (error: unknown) =>
  Telemetry.error(error, { surface: 'drive-folder-creation' });

export function createFolderCommands(options: {
  parentId?: string;
  source?: string;
}): FolderCreationCommands {
  const generation = cacheSessionGeneration.capture();
  return {
    async create(name) {
      const id = await createProject({ name, ...options });
      if (!id) throw new Error('Folder was not created');
      return id;
    },
    async saveTags(id, tags) {
      if (!cacheSessionGeneration.isCurrent(generation)) return;
      const properties = Object.entries(tags)
        .filter(([, ids]) => ids.length > 0)
        .map(([propertyDefinitionId, addOptionIds]) => ({
          propertyDefinitionId,
          addOptionIds,
          removeOptionIds: [],
        }));
      if (!properties.length) return;
      await saveCreatedEntityTags({
        entityType: 'PROJECT',
        entityId: id,
        properties,
      });
    },
    async upload(id, file) {
      const [result] = await uploadFiles([file], 'dss', { projectId: id });
      if (!result || result.failed) throw new Error('Upload failed');
      if (result.type === 'folder') {
        const folderId = await result.projectId;
        if (!folderId) throw new Error('Folder upload failed');
        refetchSoupEntity(folderId, 'project', { includeRoot: true }).catch(
          reportRefetchError
        );
      } else {
        refetchSoupEntity(result.documentId, 'document').catch(
          reportRefetchError
        );
      }
      fireAndForget(refetchHistory(), 'drive-folder-creation');
    },
  };
}
