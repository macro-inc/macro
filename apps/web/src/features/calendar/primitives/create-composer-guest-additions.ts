import type { Accessor } from 'solid-js';
import type { SelectedEventEditorGuest } from '../components/composer/event-form-model';
import { composerGuestKey } from '../core/composer-guests';
import type { CalendarComposerModel } from './create-calendar-composer';

export function createComposerGuestAdditions(options: {
  current: Accessor<SelectedEventEditorGuest[]>;
  added: Accessor<SelectedEventEditorGuest[]>;
  disabled: Accessor<boolean>;
  onChange: (added: SelectedEventEditorGuest[]) => void;
}) {
  const isCurrent = (guest: SelectedEventEditorGuest) =>
    options
      .current()
      .some((current) => composerGuestKey(current) === composerGuestKey(guest));
  const replace = (picked: SelectedEventEditorGuest[]) => {
    if (options.disabled()) return;
    const seen = new Set(options.current().map(composerGuestKey));
    const next: SelectedEventEditorGuest[] = [];
    for (const guest of picked) {
      const key = composerGuestKey(guest);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(guest);
    }
    const current = options.added();
    if (
      next.length === current.length &&
      next.every((guest, index) => guest === current[index])
    )
      return;
    options.onChange(next);
  };
  return {
    excluded: () => [...options.current(), ...options.added()],
    canRemove: (guest: SelectedEventEditorGuest) => !isCurrent(guest),
    replace,
    add: (picked: SelectedEventEditorGuest[]) =>
      replace([...options.added(), ...picked]),
    remove: (guest: SelectedEventEditorGuest) => {
      if (options.disabled() || isCurrent(guest)) return;
      const key = composerGuestKey(guest);
      replace(
        options.added().filter((added) => composerGuestKey(added) !== key)
      );
    },
  };
}

/** Shared projection for fixed guests and editable additions across composer layouts. */
export function createComposerGuestSelection(
  guests: CalendarComposerModel['guests']
) {
  const current = () => guests.currentGuests ?? [];
  const added = () =>
    guests.selected.filter(
      (guest) =>
        !current().some(
          (fixed) => composerGuestKey(fixed) === composerGuestKey(guest)
        )
    );
  const disabled = () => guests.disabled || guests.readOnly;
  const selection = createComposerGuestAdditions({
    current,
    added,
    disabled,
    onChange: (next) => guests.onChange([...current(), ...next]),
  });
  return { current, added, disabled, selection };
}
