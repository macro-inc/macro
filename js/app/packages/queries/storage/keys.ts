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

export const documentGithubPullRequestsKeys = createQueryKeys(
  'documentGithubPullRequests',
  {
    list: (documentId: string) => ({
      queryKey: [documentId],
    }),
  }
);

export const attachmentReferencesKeys = createQueryKeys(
  'attachmentReferences',
  {
    list: (entityType: string, entityId: string) => ({
      queryKey: [entityType, entityId],
    }),
  }
);

// Scoped under `entity` so `invalidateQueries({ queryKey: ['entity'] })`
// (fired from the move/rename mutations) refreshes every key below.
export const entityKeys = createQueryKeys('entity', {
  documentMetadata: (documentId: string) => ({
    queryKey: [documentId],
  }),
  projectData: (projectId: string) => ({
    queryKey: [projectId],
  }),
  taskDuplicates: (documentId: string) => ({
    queryKey: [documentId, 'duplicates'],
  }),
  documentTeamShare: (documentId: string) => ({
    queryKey: [documentId, 'teamShare'],
  }),
});

export const taskSimilaritySearchKeys = createQueryKeys(
  'taskSimilaritySearch',
  {
    forInput: (input: {
      title: string;
      markdown: string;
      shareWithTeam: boolean;
    }) => ({
      queryKey: [input.title, input.markdown, input.shareWithTeam],
    }),
  }
);

export const instructionsMdKeys = createQueryKeys('instructionsMd', {
  id: null,
  text: (id: string) => ({
    queryKey: [id],
  }),
});

/**
 * @deprecated Use the specific key exports directly.
 */
export const storageKeys = {
  projects: projectsKeys,
  deleted: deletedKeys,
  documentGithubPullRequests: documentGithubPullRequestsKeys,
};
