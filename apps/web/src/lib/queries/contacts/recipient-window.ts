import { isAutomatedAddress } from '@core/user/automated-address';
import {
  type CombinedRecipientItem,
  recipientEntityMapper,
} from '@core/user/combinedRecipient';
import type {
  RecipientSource,
  RecipientSourceInput,
} from '@core/user/recipient-source';
import type { IUser } from '@core/user/types';
import { createMemo } from 'solid-js';
import { readContactDirectory } from './directory';
import { createContactDirectoryList } from './directory-list';
import type { createContactDirectoryWindow } from './directory-query';
import { createContactExclusions } from './exclusions';

const WHITE_SPACE = /\p{White_Space}+/u;

const isSubsequence = (word: string, text: string) => {
  let position = 0;
  for (const character of word) {
    const next = text.indexOf(character, position);
    if (next < 0) return false;
    position = next + character.length;
  }
  return true;
};

/** Whether a listed person can still match text typed since, as the contact
 * cache matches recipients (`cache-core` people ranking): every word of the
 * text, split at white space only, in order within the person's name (else
 * the address's local part) and address. */
const stillMatches = (search: string) => {
  const words = search.toLowerCase().split(WHITE_SPACE).filter(Boolean);
  return (item: CombinedRecipientItem<'user'>) => {
    const { name, email } = item.data;
    const label = (name ?? email.split('@')[0])
      .split(WHITE_SPACE)
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const text = `${label} | ${email.toLowerCase()}`;
    return words.every((word) => isSubsequence(word, text));
  };
};

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
  const directory = createContactDirectoryList(scope, reader, input.enabled, {
    search: input.search,
    resetKey: exclusions.key,
    policy: () => ({
      mode: 'recipient',
      excluded: exclusions.native(),
      senderDomain: input.senderDomain(),
    }),
    // Roster members beyond the native budget never count toward the bound.
    eligible: (user) =>
      !exclusions.ids().has(user.id) && !isSecondaryInbox(user.id),
  });
  // Normal rosters are excluded before native limiting. A roster larger than
  // the IPC budget can yield a short or empty page; its continuation remains,
  // and the picker keeps reading further pages.
  const listable = (user: Pick<IUser, 'id' | 'email'>) =>
    !exclusions.ids().has(user.id) &&
    !isSecondaryInbox(user.id) &&
    (!isAutomatedAddress(user.email) ||
      input
        .search()
        .trim()
        .replace(/^macro\|/, '')
        .toLowerCase() === user.email.toLowerCase());
  let shownFor: string | undefined;
  return {
    items: createMemo<CombinedRecipientItem<'user'>[]>((shown) => {
      const page = directory.data();
      const current = scope();
      const owner = `${current.userId ?? ''}\n${current.host?.clientId ?? ''}\n${directory.generation()}`;
      if (!page) {
        // The list drops its page from each keystroke until the read for
        // the new text lands. Keep the people shown who still match that
        // text rather than emptying the list on every keystroke.
        const pending =
          input.enabled() &&
          shownFor === owner &&
          directory.loading() &&
          !directory.error();
        if (!pending) return shown.length ? [] : shown;
        const matches = stillMatches(input.search());
        const kept = shown.filter(
          (item) => listable(item.data) && matches(item)
        );
        return kept.length === shown.length ? shown : kept;
      }
      // Only rows read in this generation belong to it: the list keeps
      // earlier rows on screen across a change, while it reads and below a
      // re-read first page.
      if (directory.readNow()) shownFor = owner;
      return (
        page.users
          .filter(listable)
          // Selected chips outlive this query window: retain scalar display
          // data, not the query-store objects from which it was materialized.
          .map((user) =>
            recipientEntityMapper('user')({
              id: user.id,
              email: user.email,
              name: user.name,
              photoUrl: user.photoUrl,
              lastInteraction: user.lastInteraction,
            })
          )
      );
    }, []),
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
