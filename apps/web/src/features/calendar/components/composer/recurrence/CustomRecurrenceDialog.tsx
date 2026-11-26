import { t } from '@app/lib/i18n';
import { Button, Dialog } from '@ui';
import { createSignal } from 'solid-js';
import type { CustomRecurrenceInput } from '../../../primitives/create-custom-recurrence';
import { isValidRecurrenceConfig } from '../../../utils/recurrence';
import { CustomRecurrence } from './CustomRecurrence';

/** Stage the repeat rule until Done; dismissing never modifies the composer. */
export function CustomRecurrenceDialog(
  props: CustomRecurrenceInput & { onClose: () => void }
) {
  const [value, setValue] = createSignal(props.value);
  const apply = () => {
    if (props.disabled || !isValidRecurrenceConfig(value())) return;
    props.onChange(value());
    props.onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-96 max-w-[calc(100vw-16px)]"
      onEscapeKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div class="flex flex-col gap-4 p-5">
        <Dialog.Title class="text-lg font-semibold">
          {t('calendar.customRepeat')}
        </Dialog.Title>
        <CustomRecurrence
          value={value()}
          start={props.start}
          allDay={props.allDay}
          disabled={props.disabled}
          onChange={setValue}
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={apply}
            disabled={props.disabled || !isValidRecurrenceConfig(value())}
          >
            {t('calendar.done')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
