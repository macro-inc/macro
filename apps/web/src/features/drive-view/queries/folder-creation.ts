import { uploadFiles } from '@core/util/upload';
import { refetchHistory } from '@queries/history/history';
import { refetchSoupEntity } from '@queries/soup/cache';
import { createProject } from '@queries/storage/projects';
import { propertiesServiceClient } from '@service-properties/client';
import type { FolderCreationCommands } from '../core/folder-composer';

export function createFolderCommands(options: {
  parentId?: string;
  source?: string;
}): FolderCreationCommands {
  return {
    async create(name) {
      const id = await createProject({ name, ...options });
      if (!id) throw new Error('Folder was not created');
      return id;
    },
    async saveTags(id, tags) {
      const properties = Object.entries(tags)
        .filter(([, ids]) => ids.length > 0)
        .map(([property_id, add_option_ids]) => ({
          property_id,
          add_option_ids,
          remove_option_ids: [],
        }));
      if (!properties.length) return;
      const result =
        await propertiesServiceClient.bulkUpdateEntityPropertyOptions({
          entity_type: 'PROJECT',
          entity_id: id,
          body: { properties },
        });
      if (result.isErr()) throw result.error;
      refetchSoupEntity(id, 'project', { refreshGraphql: true });
    },
    async upload(id, file) {
      const [result] = await uploadFiles([file], 'dss', { projectId: id });
      if (!result || result.failed) throw new Error('Upload failed');
      if (result.type === 'folder') {
        const folderId = await result.projectId;
        if (!folderId) throw new Error('Folder upload failed');
        refetchSoupEntity(folderId, 'project', { includeRoot: true });
      } else {
        refetchSoupEntity(result.documentId, 'document');
      }
      refetchHistory();
    },
  };
}
