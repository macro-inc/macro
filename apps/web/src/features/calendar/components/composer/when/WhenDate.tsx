import { formatLocale, t } from '@app/lib/i18n';
import { Button } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { whenDateLabel } from '../../../core/when-summary';

export function WhenDate(props: {
  endpoint: 'start' | 'end';
  desktop?: boolean;
}) {
  const model = useCalendarComposer();
  const when = model.when;
  const key = () => (props.endpoint === 'start' ? 'start-date' : 'end-date');
  return (
    <Button
      variant="value"
      size={props.desktop ? 'select' : 'field'}
      class={props.desktop ? 'w-20' : 'w-[110px]'}
      data-composer-date={props.endpoint}
      aria-label={t(
        props.endpoint === 'start'
          ? 'common.editStartDate'
          : 'common.editEndDate',
        { subject: t('calendar.eventKindEvent') }
      )}
      aria-expanded={
        !model.fieldIsDisabled(props.endpoint) && when.state.active === key()
      }
      aria-haspopup="grid"
      disabled={model.fieldIsDisabled(props.endpoint)}
      onClick={() => when.toggle(key())}
    >
      {whenDateLabel(
        model.state()[props.endpoint],
        formatLocale(),
        props.desktop
      )}
    </Button>
  );
}
