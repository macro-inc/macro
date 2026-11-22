import { formatLocale, t } from '@app/lib/i18n';
import { Button } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { useComposerWhen } from '../../../context/composer-when-context';
import { whenDateLabel } from '../../../core/when-summary';

export function WhenDate(props: { endpoint: 'start' | 'end' }) {
  const model = useCalendarComposer(),
    when = useComposerWhen();
  const key = () => (props.endpoint === 'start' ? 'start-date' : 'end-date');
  return (
    <Button
      variant="value"
      size="field"
      class="w-[110px] justify-start px-3 font-normal"
      data-composer-date={props.endpoint}
      aria-label={t(
        props.endpoint === 'start'
          ? 'common.editStartDate'
          : 'common.editEndDate',
        { subject: 'event' }
      )}
      aria-expanded={when.state.active === key()}
      aria-haspopup="grid"
      disabled={model.fieldIsDisabled(props.endpoint)}
      onClick={() => when.toggle(key())}
    >
      {whenDateLabel(model.state()[props.endpoint], formatLocale())}
    </Button>
  );
}
