import type { SearchableOptionSourceFactory } from '@app/features/next-soup/soup-view/filters-bar/option-source';
import { useQueryAccount } from '@queries/auth/use-query-account';
import {
  useContactIdFilterSource,
  usePinnedContactUsers,
} from '@queries/contacts/use-directory';
import { type Accessor, createMemo } from 'solid-js';
import {
  contactFilterRow,
  createContactFilterOptions,
} from './contact-filter-options';

/** Labels for active chips do not open a browse/search window. Unknown saved
 * IDs retain their representation while explicit identity lookup is pending. */
export function useContactFilterLabels(selected: Accessor<readonly string[]>) {
  const account = useQueryAccount();
  const users = usePinnedContactUsers(selected, () => selected().length > 0);
  return createMemo(() => {
    const known = new Map(users().map((user) => [user.id, user]));
    const viewer = account()?.userId;
    return new Map(
      selected().map((id) => [
        id,
        contactFilterRow(id, known.get(id.toLowerCase()), viewer).option,
      ])
    );
  });
}

/** App composition for ID-valued people facets. */
export const useContactFilterOptions: SearchableOptionSourceFactory = (
  selected,
  enabled
) =>
  createContactFilterOptions(
    useContactIdFilterSource(selected, enabled),
    selected
  );
