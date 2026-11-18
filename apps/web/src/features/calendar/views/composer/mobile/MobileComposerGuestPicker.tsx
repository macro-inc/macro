import { t } from '@app/lib/i18n';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import UsersIcon from '@icon/system/regular/users.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { SelectedEventEditorGuest } from '../../../components/composer/event-form-model';
import { MobileComposerGuestPickerSession } from './MobileComposerGuestPickerSession';

/** Mount this part only while guest editing is permitted, so losing permission drops the session. */
export function MobileComposerGuestPicker(props: {
  current: () => SelectedEventEditorGuest[];
  added: () => SelectedEventEditorGuest[];
  onAddedChange: (added: SelectedEventEditorGuest[]) => void;
  showIcon: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const close = () => setOpen(false);

  return (
    <>
      <SheetRow
        icon={
          <Show when={props.showIcon}>
            <UsersIcon class="size-4" />
          </Show>
        }
      >
        <Button
          variant="value"
          size="sm"
          class="text-ink-subtle"
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen(true)}
        >
          {t('calendar.addPeople')}
        </Button>
      </SheetRow>
      <Show when={open()}>
        <MobileComposerGuestPickerSession
          current={props.current}
          added={props.added}
          onAddedChange={props.onAddedChange}
          onClose={close}
        />
      </Show>
    </>
  );
}
