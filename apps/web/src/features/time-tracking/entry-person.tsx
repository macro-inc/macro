import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import type { EntryPerson } from './components/entry-list';

function personName(userId: string): string {
  return getDisplayName(tryMacroId(userId));
}

/** Who logged an entry, as entry rows show them, with no card of their own. */
export const ENTRY_PERSON: EntryPerson = {
  avatar: (userId) => (
    <UserIcon
      id={userId}
      name={personName(userId)}
      size="sm"
      suppressClick
      showTooltip={false}
    />
  ),
  name: personName,
};
