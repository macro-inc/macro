import { createQueryKeys } from '@lukemorales/query-key-factory';

export const projectsKeys = createQueryKeys('projects', {
  list: null,
  preview: (projectId: string) => ({
    queryKey: [projectId],
  }),
});

const deletedKeys = createQueryKeys('deleted', {
  list: null,
});

export const documentLocationKeys = createQueryKeys('documentLocation', {
  location: (documentId: string, versionId?: number) => ({
    queryKey: [documentId, versionId],
  }),
  wait: (
    documentId: string,
    versionId: number | undefined,
    target: string,
    timeoutMs: number
  ) => ({
    queryKey: ['wait', target, documentId, versionId, timeoutMs],
  }),
});

export const binaryDocumentKeys = createQueryKeys('binaryDocument', {
  document: (documentId: string) => ({
    queryKey: [documentId],
  }),
});

// Scoped under `entity` so `invalidateQueries({ queryKey: ['entity'] })`
// (fired from the move/rename mutations) refreshes every key below.
export const entityKeys = createQueryKeys('entity', {
  documentMetadata: (documentId: string) => ({
    queryKey: [documentId],
  }),
  projectData: (projectId: string) => ({
    queryKey: [projectId],
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
