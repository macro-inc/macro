import { createQueryKeys } from '@lukemorales/query-key-factory';

export const projectsKeys = createQueryKeys('projects', {
  list: null,
  preview: (projectId: string) => ({
    queryKey: [projectId],
  }),
});

export const deletedKeys = createQueryKeys('deleted', {
  list: null,
});

export const binaryDocumentKeys = createQueryKeys('binaryDocument', {
  document: (documentId: string) => ({
    queryKey: [documentId],
  }),
});

export const instructionsMdKeys = createQueryKeys('instructionsMd', {
  id: null,
  text: (id: string) => ({
    queryKey: [id],
  }),
});

/**
 * @deprecated Use `projectsKeys` or `deletedKeys` directly
 */
export const storageKeys = {
  projects: projectsKeys,
  deleted: deletedKeys,
};
