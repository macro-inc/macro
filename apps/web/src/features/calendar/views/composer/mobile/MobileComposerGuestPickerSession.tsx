import { t } from '@app/lib/i18n';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { createSignal } from 'solid-js';
import type { SelectedEventEditorGuest } from '../../../components/composer/event-form-model';
import { ComposerGuestPicker } from '../../../components/composer/guests/ComposerGuestPicker';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { createComposerGuestAdditions } from '../../../primitives/create-composer-guest-additions';

export function MobileComposerGuestPickerSession(props: {
  current: () => SelectedEventEditorGuest[];
  added: () => SelectedEventEditorGuest[];
  onAddedChange: (added: SelectedEventEditorGuest[]) => void;
  onClose: () => void;
}) {
  const model = useCalendarComposer();
  const [draft, setDraft] = createSignal(props.added());
  const changes = createComposerGuestAdditions({
    current: props.current,
    added: draft,
    disabled: () => model.guests.disabled || model.guests.readOnly,
    onChange: setDraft,
  });
  const done = () => {
    if (model.guests.disabled || model.guests.readOnly) {
      props.onClose();
      return;
    }
    props.onAddedChange(draft());
    props.onClose();
  };
  return (
    <PickerSheet.Root open onCancel={props.onClose}>
      <PickerSheet.Header title={t('calendar.guests')} onDone={done} />
      <PickerSheet.Body>
        <ComposerGuestPicker
          options={model.guests.options}
          selected={draft()}
          excluded={props.current()}
          onChange={changes.replace}
          onClose={props.onClose}
          fillHeight
        />
      </PickerSheet.Body>
    </PickerSheet.Root>
  );
}
