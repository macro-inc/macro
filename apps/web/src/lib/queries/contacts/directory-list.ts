import type { IUser } from '@core/user/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { hashKey } from '@tanstack/solid-query';
import { createMemo, createSignal } from 'solid-js';
import type { ContactDirectoryPage, RankedPerson } from './directory';
import { createContactDirectoryWindow } from './directory-query';

/** Listed pages stay bounded however far a picker or menu is scrolled. */
export const MAX_LISTED_CONTACTS = 500;

/**
 * A directory window whose further pages are listed below the earlier ones, up
 * to a bound. Takes the window's arguments and returns its shape, with `data`
 * holding every listed row and the current continuation.
 */
export function createContactDirectoryList(
  ...args: Parameters<typeof createContactDirectoryWindow>
) {
  const [scope, , enabled = () => true, options = {}] = args;
  const window = createContactDirectoryWindow(...args);
  /** What the listed pages belong to: the account, the text, and who is eligible. */
  const listKey = () => {
    const current = scope();
    return hashKey([
      current.userId,
      current.host?.clientId,
      window.search(),
      options.policy?.(),
      options.resetKey?.(),
    ]);
  };
  let listed:
    | { key: string; first: IUser[]; later: IUser[]; people: RankedPerson[] }
    | undefined;
  const data = createMemo<ContactDirectoryPage | undefined>((shown) => {
    const page = window.data();
    const key = listKey();
    if (!page) {
      // The window drops its page while it reads the next one, re-reads the
      // first after a contact change, or fails. Keep the rows already listed
      // for this input; closing or a new input starts again at page one.
      if (!enabled()) listed = undefined;
      const kept =
        listed?.key === key && (window.loading() || !!window.error());
      return kept ? shown : undefined;
    }

    if (listed?.key !== key) {
      listed = { key, first: page.users, later: [], people: page.people ?? [] };
    } else if (window.continued()) {
      const known = new Set(
        [...listed.first, ...listed.later].map((user) => user.id)
      );
      const people = new Set(listed.people.map((person) => person.userId));
      listed = {
        ...listed,
        later: [
          ...listed.later,
          ...page.users.filter((user) => !known.has(user.id)),
        ],
        people: [
          ...listed.people,
          ...(page.people ?? []).filter((person) => !people.has(person.userId)),
        ],
      };
    } else {
      // A re-read of the first page keeps the pages already listed below it.
      const first = new Set(page.users.map((user) => user.id));
      const people = new Set(page.people?.map((person) => person.userId));
      listed = {
        key,
        first: page.users,
        later: listed.later.filter((user) => !first.has(user.id)),
        people: [
          ...(page.people ?? []),
          ...listed.people.filter((person) => !people.has(person.userId)),
        ],
      };
    }

    const users = [...listed.first, ...listed.later];
    return {
      ...page,
      users,
      people: listed.people,
      nextCursor: users.length < MAX_LISTED_CONTACTS ? page.nextCursor : null,
    };
  });

  const [loadingMore, setLoadingMore] = createSignal(false);
  /** One page in flight at a time; the bound and the last page end the list. */
  const loadNext = async () => {
    if (loadingMore() || !data()?.nextCursor) return;
    setLoadingMore(true);
    try {
      await window.loadNext();
    } finally {
      setLoadingMore(false);
    }
  };

  return {
    ...window,
    data,
    /** Names the growing list on screen; appending a page keeps it. */
    windowKey: () => (data() ? listKey() : undefined),
    loadingMore,
    loadNext,
    next: () => fireAndForget(loadNext(), 'contacts'),
  };
}

export type ContactDirectoryList = ReturnType<
  typeof createContactDirectoryList
>;
