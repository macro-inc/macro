import { isAutomatedAddress } from '@core/user/automated-address';
import { recipientEntityMapper } from '@core/user/combinedRecipient';
import type {
  RecipientSource,
  RecipientSourceInput,
} from '@core/user/recipient-source';
import { MAX_PEOPLE_BATCH } from '@graphql-cache/people/generated';
import { hashKey } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { canonicalContactUserId } from './contact-user-id';
import { readContactDirectory } from './directory';
import { createContactDirectoryWindow } from './directory-query';

/** A selector's query, exclusions and domain reach the ranker before its limit. */
export function createContactRecipientSource(
  scope: Parameters<typeof createContactDirectoryWindow>[0],
  input: RecipientSourceInput,
  isSecondaryInbox: (id: string) => boolean,
  reader: typeof readContactDirectory = readContactDirectory
): RecipientSource<'user'> {
  const excluded = createMemo(() => {
    const ids = new Set<string>();
    const self = input.selfId();
    if (self && !input.includeSelf()) ids.add(self);
    for (const value of input.excludedIds?.() ?? []) {
      const id = canonicalContactUserId(value);
      if (id) ids.add(id);
    }
    return ids;
  });
  const nativeExclusions = createMemo(() => {
    const ids: string[] = [];
    for (const id of excluded()) {
      if (ids.length === MAX_PEOPLE_BATCH) break;
      ids.push(id);
    }
    return ids;
  });
  const exclusionKey = createMemo(() => hashKey([[...excluded()].sort()]));
  const directory = createContactDirectoryWindow(scope, reader, input.enabled, {
    search: input.search,
    resetKey: exclusionKey,
    policy: () => ({
      mode: 'recipient',
      excluded: nativeExclusions(),
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
            !excluded().has(user.id) &&
            !isSecondaryInbox(user.id) &&
            (!isAutomatedAddress(user.email) ||
              input.search().trim().toLowerCase() === user.email.toLowerCase())
        )
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
