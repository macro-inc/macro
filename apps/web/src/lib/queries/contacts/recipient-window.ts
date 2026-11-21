import { isAutomatedAddress } from '@core/user/automated-address';
import { recipientEntityMapper } from '@core/user/combinedRecipient';
import type {
  RecipientSource,
  RecipientSourceInput,
} from '@core/user/recipient-source';
import { type Accessor, createMemo } from 'solid-js';
import { readContactDirectory } from './directory';
import { createContactDirectoryList } from './directory-list';
import type { createContactDirectoryWindow } from './directory-query';
import { createContactExclusions } from './exclusions';

/** A selector's query, exclusions and domain reach the ranker before its limit. */
export function createContactRecipientSource(
  scope: Parameters<typeof createContactDirectoryWindow>[0],
  input: RecipientSourceInput,
  isSecondaryInbox: (id: string) => boolean,
  reader: typeof readContactDirectory = readContactDirectory,
  /** Members of the viewer's team, to rank a page the server did not. */
  teammates?: Accessor<ReadonlySet<string>>
): RecipientSource<'user'> {
  const exclusions = createContactExclusions(
    () => input.excludedIds?.() ?? [],
    () => (input.includeSelf() ? undefined : input.selfId())
  );
  const directory = createContactDirectoryList(scope, reader, input.enabled, {
    search: input.search,
    resetKey: exclusions.key,
    teammates,
    policy: () => ({
      mode: 'recipient',
      excluded: exclusions.native(),
      senderDomain: input.senderDomain(),
    }),
    // Roster members beyond the native budget never count toward the bound.
    eligible: (user) =>
      !exclusions.ids().has(user.id) && !isSecondaryInbox(user.id),
  });
  return {
    items: createMemo(() =>
      (directory.data()?.users ?? [])
        // Normal rosters are excluded before native limiting. A roster larger
        // than the IPC budget can yield a short or empty page; its
        // continuation remains, and the picker keeps reading further pages.
        .filter(
          (user) =>
            !exclusions.ids().has(user.id) &&
            !isSecondaryInbox(user.id) &&
            (!isAutomatedAddress(user.email) ||
              input
                .search()
                .trim()
                .replace(/^macro\|/, '')
                .toLowerCase() === user.email.toLowerCase())
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
