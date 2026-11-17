import { t } from '@app/lib/i18n';
import { Tabs } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function MobileComposerKind() {
  const model = useCalendarComposer();
  return (
    <Tabs
      aria-label={t('calendar.eventKind')}
      options={[
        { value: 'default', label: t('calendar.eventKindEvent') },
        { value: 'out_of_office', label: t('calendar.eventKindOutOfOffice') },
      ]}
      value={model.controller.eventKind()}
      onChange={model.controller.setEventKind}
      disabled={
        model.formIsDisabled() || model.isEdit() || model.detailsLocked()
      }
      variant="choices"
      wrap
      touch="pills"
      size="md"
    />
  );
}
