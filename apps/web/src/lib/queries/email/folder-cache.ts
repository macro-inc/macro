import { queryClient } from '../client';
import { soupKeys } from '../soup/keys';

/** Folder previews are intentionally outside both shared entity caches. */
export function invalidateEmailFolderQueries() {
  return queryClient.invalidateQueries({
    queryKey: soupKeys.astItems._def,
    predicate: (query) =>
      query.queryKey.some(
        (part) =>
          typeof part === 'object' &&
          part !== null &&
          'emailView' in part &&
          (part.emailView === 'spam' || part.emailView === 'trash')
      ),
  });
}
