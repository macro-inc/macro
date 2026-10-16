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

export const snippetRawKeys = createQueryKeys('snippetRaw', {
  document: (documentId: string) => ({
    queryKey: [documentId],
  }),
});

export const githubPullRequestRefreshKeys = createQueryKeys(
  'githubPullRequestRefresh',
  {
    refresh: (githubKey: string) => ({
      queryKey: [githubKey],
    }),
  }
);

export const documentGithubPullRequestsKeys = createQueryKeys(
  'documentGithubPullRequests',
  {
    list: (documentId: string) => ({
      queryKey: [documentId],
    }),
  }
);

export const githubPullRequestChangesKeys = createQueryKeys(
  'githubPullRequestChanges',
  {
    summary: (foreignEntityId: string) => ({
      queryKey: [foreignEntityId],
    }),
    patch: (foreignEntityId: string, changesetId: string) => ({
      queryKey: [foreignEntityId, changesetId],
    }),
  }
);

export const pullRequestMentionKeys = createQueryKeys('pullRequestMention', {
  foreignEntity: (id: string) => ({
    queryKey: [id],
  }),
  byGithubKey: (githubKey: string) => ({
    queryKey: ['byGithubKey', githubKey],
  }),
});

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
  documentAccessLevel: (documentId: string) => ({
    queryKey: [documentId, 'accessLevel'],
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
    forInput: (input: { title: string; markdown: string }) => ({
      queryKey: [input.title, input.markdown],
    }),
  }
);

export const teamTaskKeys = createQueryKeys('teamTask', {
  bySlug: (slug: string) => ({
    queryKey: [slug],
  }),
});

export const databasesKeys = createQueryKeys('databases', {
  list: null,
  starter: (userId: string) => ({ queryKey: [userId] }),
  detail: (databaseId: string) => ({
    queryKey: [databaseId],
  }),
});

export const formsKeys = createQueryKeys('forms', {
  list: null,
  forDatabase: (databaseId: string) => ({ queryKey: [databaseId] }),
  detail: (formId: string) => ({ queryKey: [formId] }),
  mine: (formId: string, userId: string) => ({ queryKey: [formId, userId] }),
  summary: (formId: string) => ({ queryKey: [formId] }),
  tally: (formId: string) => ({ queryKey: [formId] }),
  permissions: (formId: string) => ({ queryKey: [formId] }),
});

/** One form's own-response queries, whoever the viewer is. */
export const myResponseKeyOf = (formId: string) =>
  [...formsKeys.mine._def, formId] as const;

export const savedDatabaseQueryKeys = createQueryKeys('saved-database-query', {
  definition: (queryId: string) => ({ queryKey: [queryId] }),
});

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
