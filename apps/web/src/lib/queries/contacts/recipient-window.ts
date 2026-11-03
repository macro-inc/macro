import { recipientEntityMapper } from '@core/user/combinedRecipient';
import type {
  RecipientSource,
  RecipientSourceInput,
} from '@core/user/recipient-source';
import { createMemo } from 'solid-js';
import { readContactDirectory } from './directory';
import { createContactDirectoryWindow } from './directory-query';

/** A selector's query, exclusions and domain reach the ranker before its limit. */
export function createContactRecipientSource(
  scope: Parameters<typeof createContactDirectoryWindow>[0],
  input: RecipientSourceInput,
  isSecondaryInbox: (id: string) => boolean,
  reader: typeof readContactDirectory = readContactDirectory
): RecipientSource<'user'> {
  const directory = createContactDirectoryWindow(scope, reader, input.enabled, {
    search: input.search,
    policy: () => {
      const self = input.selfId();
      return {
        mode: 'recipient',
        excluded: self && !input.includeSelf() ? [self] : [],
        senderDomain: input.senderDomain(),
      };
    },
  });
  return {
    items: createMemo(() =>
      (directory.data()?.users ?? [])
        // The native policy excludes these before limiting. Server fallback is
        // source-ordered and can leave a short/empty window with a continuation.
        .filter((user) => !isSecondaryInbox(user.id))
        .map(recipientEntityMapper('user'))
    ),
    loading: directory.loading,
    error: directory.error,
    incomplete: () => {
      const page = directory.data();
      return !!page && (page.offline || page.sync !== 'snapshot');
    },
    hasNext: () => !!directory.data()?.nextCursor,
    windowKey: directory.windowKey,
    next: directory.loadNext,
    retry: directory.retry,
  };
}
