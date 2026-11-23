import { t } from '@app/lib/i18n';
import { TextField } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerLocation(
  props: {
    inputRef?: (element: HTMLTextAreaElement) => void;
    rows?: number;
    plain?: boolean;
  } = {}
) {
  const model = useCalendarComposer();
  return (
    <TextField
      value={model.state().location}
      onChange={(location) => model.controller.setField('location', location)}
      disabled={model.fieldIsDisabled('location')}
      class="w-full"
    >
      <TextField.Surface
        class={
          props.plain
            ? 'min-h-8 rounded-lg border-0 bg-transparent px-3 py-0 shadow-none hover:bg-hover focus-within:bg-active'
            : 'focus-within:border-accent focus-within:ring-[1.5px] focus-within:ring-accent'
        }
      >
        <TextField.TextArea
          variant="embedded"
          rows={props.rows ?? 1}
          autoResize
          class={props.plain ? 'min-h-8 max-h-18 overflow-y-auto' : undefined}
          ref={props.inputRef}
          aria-label={t('calendar.location')}
          placeholder={t('calendar.addLocation')}
        />
      </TextField.Surface>
    </TextField>
  );
}
