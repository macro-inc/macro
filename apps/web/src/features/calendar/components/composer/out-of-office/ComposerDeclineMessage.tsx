import { t } from '@app/lib/i18n';
import { TextField } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerDeclineMessage() {
  const model = useCalendarComposer();
  return (
    <TextField
      value={model.state().outOfOffice?.declineMessage ?? ''}
      disabled={model.fieldIsDisabled('outOfOffice')}
      onChange={(declineMessage) => {
        const current = model.state().outOfOffice;
        if (!current || model.fieldIsDisabled('outOfOffice')) return;
        model.controller.setOutOfOffice({ ...current, declineMessage });
      }}
    >
      <TextField.TextArea
        autoResize
        rows={2}
        aria-label={t('calendar.declineMessage')}
        placeholder={t('calendar.declineMessage')}
      />
    </TextField>
  );
}
