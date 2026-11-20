import type { IUser } from '@core/user/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { hashKey } from '@tanstack/solid-query';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  type ContactDirectoryPage,
  type RankedPerson,
  readContactDirectory,
} from './directory';
import { createContactDirectoryWindow } from './directory-query';
import { createContactSearchTrace } from './search-trace';

/** Listed pages stay bounded however far a picker or menu is scrolled. */
export const MAX_LISTED_CONTACTS = 500;

type WindowParameters = Parameters<typeof createContactDirectoryWindow>;

/** The rows listed for one input. `readIn` is the generation of the oldest. */
type Listed = { key: string; first: IUser[]; later: IUser[]; readIn: number };

/** A re-read of the first page keeps the pages already listed below it, and
 * with them the generation they were read in. */
function rereadFirstPage(
  listed: Listed,
  fresh: IUser[],
  generation: number
): Listed {
  const first = new Set(fresh.map((user) => user.id));
  const later = listed.later.filter((user) => !first.has(user.id));
  return {
    key: listed.key,
    first: fresh,
    later,
    readIn: later.length ? listed.readIn : generation,
  };
}

/**
 * A directory window whose further pages are listed below the earlier ones, up
 * to a bound. Takes the window's arguments and returns its shape, with `data`
 * holding every listed row and the current continuation. Only `eligible` rows
 * are listed, so rows a caller drops never count toward the bound. Each
 * search's paging is traced as one `contacts.search` span.
 */
export function createContactDirectoryList(
  scope: WindowParameters[0],
  reader?: WindowParameters[1],
  enabled: Accessor<boolean> = () => true,
  options: NonNullable<WindowParameters[3]> & {
    eligible?: (user: IUser) => boolean;
  } = {}
) {
  const eligible = (users: IUser[]) =>
    options.eligible ? users.filter(options.eligible) : users;
  const trace = createContactSearchTrace(
    reader ?? readContactDirectory,
    MAX_LISTED_CONTACTS,
    eligible,
    () => options.resetKey?.()
  );
  createEffect(
    on(enabled, (active) => {
      if (!active) trace.close();
    })
  );
  onCleanup(trace.close);
  const window = createContactDirectoryWindow(
    scope,
    trace.read,
    enabled,
    options
  );
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
  let listed: Listed | undefined;
  const data = createMemo<ContactDirectoryPage | undefined>((shown) => {
    const page = window.data();
    const key = listKey();
    if (!page) {
      // The window drops its page while it reads the next one, re-reads the
      // first after a contact change, or fails. Keep the rows already listed
      // for this input; closing or a new input starts again at page one. The
      // kept rows offer no continuation: the window has no page to advance
      // from, so a request for the next one would do nothing. Returning to an
      // earlier input later starts again at page one.
      if (!enabled() || listed?.key !== key) listed = undefined;
      const kept = !!listed && (window.loading() || !!window.error());
      if (!kept || !shown) return undefined;
      return shown.nextCursor ? { ...shown, nextCursor: null } : shown;
    }

    const fresh = eligible(page.users);
    const generation = window.generation();
    if (listed?.key !== key) {
      listed = { key, first: fresh, later: [], readIn: generation };
    } else if (window.continued()) {
      const known = new Set(
        [...listed.first, ...listed.later].map((user) => user.id)
      );
      const room = MAX_LISTED_CONTACTS - listed.first.length;
      listed = {
        ...listed,
        later: [
          ...listed.later,
          ...fresh.filter((user) => !known.has(user.id)),
        ].slice(0, Math.max(room, 0)),
      };
    } else {
      listed = rereadFirstPage(listed, fresh, generation);
    }

    // Ranking metadata accompanies only the listed rows, newest page first.
    const users = [...listed.first, ...listed.later];
    const ids = new Set(users.map((user) => user.id));
    const people = new Map<string, RankedPerson>();
    for (const person of [...(page.people ?? []), ...(shown?.people ?? [])]) {
      if (ids.has(person.userId) && !people.has(person.userId))
        people.set(person.userId, person);
    }
    return {
      ...page,
      users,
      people: [...people.values()],
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
    /** Whether every row listed was read in the current generation. Read
     * after `data`, which it describes. */
    readNow: () => !!listed && listed.readIn === window.generation(),
    loadingMore,
    loadNext,
    next: () => fireAndForget(loadNext(), 'contacts'),
  };
}

export type ContactDirectoryList = ReturnType<
  typeof createContactDirectoryList
>;
