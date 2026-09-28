import { createQueryKeys } from '@lukemorales/query-key-factory';

/** Ephemeral client state, outside the persisted REST Soup query namespace. */
export const graphqlSoupKeys = createQueryKeys('graphql-soup', {
  retainedDeletions: null,
});
