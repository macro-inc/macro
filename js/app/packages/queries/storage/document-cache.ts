import type { QueryClient } from '@tanstack/solid-query';
import { documentLoadKeys } from './documentLoad/keys';
import { documentLocationKeys } from './keys';

/** Remove document data that may be scoped to the signed-in user. */
export function clearDocumentQueryCache(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: documentLoadKeys._def });
  queryClient.removeQueries({ queryKey: documentLocationKeys._def });
}
