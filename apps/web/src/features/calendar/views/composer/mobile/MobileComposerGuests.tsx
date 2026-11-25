import { t } from '@app/lib/i18n';
import { SheetGroup } from '@components/app/mobile/SheetGroup';
import { For, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { createComposerGuestSelection } from '../../../primitives/create-composer-guest-additions';
import { MobileComposerGuestPicker } from './MobileComposerGuestPicker';
import { MobileComposerGuestRow } from './MobileComposerGuestRow';

export function MobileComposerGuests() {
  const model = useCalendarComposer();
  const {
    current,
    added,
    disabled,
    selection: additions,
  } = createComposerGuestSelection(model.guests);

  return (
    <SheetGroup aria-label={t('mobile.people')}>
      <Show when={model.guests.selected.length > 0}>
        <For each={model.guests.selected}>
          {(guest, index) => (
            <MobileComposerGuestRow
              showIcon={index() === 0}
              guest={guest}
              removable={!disabled() && additions.canRemove(guest)}
              onRemove={() => additions.remove(guest)}
            />
          )}
        </For>
      </Show>
      <Show when={!disabled()}>
        <MobileComposerGuestPicker
          showIcon={model.guests.selected.length === 0}
          current={current}
          added={added}
          onAddedChange={additions.replace}
        />
      </Show>
      <Show when={model.guests.guestListHidden}>
        <p class="px-3 pb-2 text-xs text-ink-muted">
          {t('calendar.guestListHidden')}
        </p>
      </Show>
      <Show when={model.guests.readOnlyReason}>
        {(reason) => <p class="px-3 pb-2 text-xs text-ink-muted">{reason()}</p>}
      </Show>
    </SheetGroup>
  );
}
