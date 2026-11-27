import { type IUser, idToEmail, recipientEntityMapper } from '@core/user';
import { type Accessor, createMemo } from 'solid-js';
import type {
  EventEditorGuestOption,
  SelectedEventEditorGuest,
} from '../components/composer/event-form-model';
import { composerGuestKey, composerGuestUser } from '../core/composer-guests';

export function createComposerGuestSelection(options: {
  options: Accessor<EventEditorGuestOption[]>;
  selected: Accessor<SelectedEventEditorGuest[]>;
  excluded: Accessor<SelectedEventEditorGuest[]>;
  onChange: (selected: SelectedEventEditorGuest[]) => void;
}) {
  const known = () => [...options.excluded(), ...options.selected()];
  const users = createMemo(() => {
    const byId = new Map<string, IUser>();
    for (const guest of [...options.options(), ...known()]) {
      byId.set(composerGuestKey(guest), composerGuestUser(guest));
    }
    return [...byId.values()];
  });
  const excludedIds = createMemo<ReadonlySet<string>>(
    () => new Set(options.excluded().map(composerGuestKey))
  );
  // The shared selector announces user metadata before it commits its identifier set.
  let picked: SelectedEventEditorGuest | undefined;
  const guestForId = (
    id: string,
    pending: SelectedEventEditorGuest | undefined
  ) => {
    const key = id.toLowerCase();
    const current = known().find((guest) => composerGuestKey(guest) === key);
    if (current) return current;
    if (pending && composerGuestKey(pending) === key) return pending;
    const suggested = options
      .options()
      .find((guest) => composerGuestKey(guest) === key);
    if (suggested) return suggested;
    return recipientEntityMapper('custom')({
      id,
      email: idToEmail(id),
      invalid: false,
    });
  };
  return {
    users,
    excludedIds,
    selectedIds: () => new Set(options.selected().map(composerGuestKey)),
    pick: (user: IUser, custom: boolean) => {
      picked = custom
        ? recipientEntityMapper('custom')({
            id: user.id,
            email: user.email,
            invalid: false,
          })
        : recipientEntityMapper('user')(user);
    },
    commit: (ids: Set<string>) => {
      const pending = picked;
      picked = undefined;
      options.onChange([...ids].map((id) => guestForId(id, pending)));
    },
  };
}
