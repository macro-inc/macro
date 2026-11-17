import { t } from '@app/lib/i18n';
import { TextField } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerTitle(
  props: { autofocus?: boolean; submitOnEnter?: boolean } = {}
) {
  const model = useCalendarComposer();
  return (
    <TextField
      class="min-w-0 w-full"
      value={model.state().title}
      onChange={(title) => model.controller.setField('title', title)}
      disabled={model.fieldIsDisabled('title')}
    >
      <TextField.TextArea
        variant="title"
        rows={1}
        autoResize
        submitOnEnter={props.submitOnEnter ?? true}
        autofocus={props.autofocus ?? !model.isEdit()}
        aria-label={t('calendar.composerTitle')}
        placeholder={t('calendar.newEvent')}
      />
    </TextField>
  );
}
