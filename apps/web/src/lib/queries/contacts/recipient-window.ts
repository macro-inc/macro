import { isAutomatedAddress } from '@core/user/automated-address';
import { recipientEntityMapper } from '@core/user/combinedRecipient';
import type {
  RecipientSource,
  RecipientSourceInput,
} from '@core/user/recipient-source';
import { createMemo } from 'solid-js';
import { readContactDirectory } from './directory';
import { createContactDirectoryWindow } from './directory-query';
import { createContactExclusions } from './exclusions';

/** A selector's query, exclusions and domain reach the ranker before its limit. */
export function createContactRecipientSource(
  scope: Parameters<typeof createContactDirectoryWindow>[0],
  input: RecipientSourceInput,
  isSecondaryInbox: (id: string) => boolean,
  reader: typeof readContactDirectory = readContactDirectory
): RecipientSource<'user'> {
  const exclusions = createContactExclusions(
    () => input.excludedIds?.() ?? [],
    () => (input.includeSelf() ? undefined : input.selfId())
  );
  const directory = createContactDirectoryWindow(scope, reader, input.enabled, {
    search: input.search,
    resetKey: exclusions.key,
    policy: () => ({
      mode: 'recipient',
      excluded: exclusions.native(),
      senderDomain: input.senderDomain(),
    }),
  });
  return {
    items: createMemo(() =>
      (directory.data()?.users ?? [])
        // Normal rosters are excluded before native limiting. A roster larger
        // than the IPC budget, like server fallback, can yield a short/empty
        // window; retain its continuation rather than accumulating more rows.
        .filter(
          (user) =>
            !exclusions.ids().has(user.id) &&
            !isSecondaryInbox(user.id) &&
            (!isAutomatedAddress(user.email) ||
              input.search().trim().toLowerCase() === user.email.toLowerCase())
        )
        // Selected chips outlive this query window: retain scalar display data,
        // not the query-store objects from which it was materialized.
        .map((user) =>
          recipientEntityMapper('user')({
            id: user.id,
            email: user.email,
            name: user.name,
            photoUrl: user.photoUrl,
            lastInteraction: user.lastInteraction,
          })
        )
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
