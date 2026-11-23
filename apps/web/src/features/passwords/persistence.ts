import type { PersistenceStorage } from '@app/lib/persistence';
import {
  createEntryPersistenceStorage,
  type EntryPersistenceHandle,
} from '@components/app/split-layout/entry-persistence';
import { z } from 'zod';
import { PASSWORD_KINDS } from './core/kinds';
import type { PasswordGroupBy, PasswordKind } from './core/types';

export const PASSWORDS_LIST_VIEW_KEY = 'passwords.listView';

/** The list's type filter (empty shows every type) and its grouping. */
export type PasswordListView = {
  kinds: PasswordKind[];
  groupBy: PasswordGroupBy;
};

/** A new value each call: a store owns and mutates the arrays it is given. */
export function defaultPasswordListView(): PasswordListView {
  return { kinds: [], groupBy: 'none' };
}

const kindSchema = z.enum(PASSWORD_KINDS);

const storedSchema = z.object({ kinds: z.unknown(), groupBy: z.unknown() });
const groupBySchema = z.enum(['none', 'kind']);

/** The split history entry the list view is kept with. */
export type PasswordListViewEntry = EntryPersistenceHandle;

/** Keeps the type filter and grouping with the split's history entry. */
export function createPasswordListViewStorage(
  handle: EntryPersistenceHandle
): PersistenceStorage<PasswordListView> {
  return createEntryPersistenceStorage({
    handle,
    key: PASSWORDS_LIST_VIEW_KEY,
    restore: (current, stored) => {
      const parsed = storedSchema.safeParse(stored);
      if (!parsed.success) return undefined;
      // A value this build doesn't know falls back field by field, so an
      // unknown type is dropped instead of the whole entry.
      const storedKinds = Array.isArray(parsed.data.kinds)
        ? parsed.data.kinds
        : [];
      const kinds = storedKinds.flatMap((kind) => {
        const known = kindSchema.safeParse(kind);
        return known.success ? [known.data] : [];
      });
      const groupBy = groupBySchema.safeParse(parsed.data.groupBy);
      return {
        ...current,
        kinds: [...new Set(kinds)],
        groupBy: groupBy.success ? groupBy.data : 'none',
      };
    },
    select: (view): PasswordListView => ({
      kinds: [...view.kinds],
      groupBy: view.groupBy,
    }),
  });
}
