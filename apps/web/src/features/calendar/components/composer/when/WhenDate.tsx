import { formatLocale, t } from '@app/lib/i18n';
import { parseLocalDate } from '@core/util/local-date';
import { Button } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { useComposerWhen } from '../../../context/composer-when-context';
import { whenDateLabel } from '../../../core/when-summary';

export function WhenDate(props: {
  endpoint: 'start' | 'end';
  desktop?: boolean;
}) {
  const model = useCalendarComposer(),
    when = useComposerWhen();
  const key = () => (props.endpoint === 'start' ? 'start-date' : 'end-date');
  return (
    <Button
      variant="value"
      size={props.desktop ? 'sm' : 'field'}
      class={
        props.desktop
          ? 'h-8 w-20 shrink-0 justify-start rounded-lg px-3 text-sm font-normal'
          : 'w-[110px] justify-start px-3 font-normal'
      }
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
      {props.desktop
        ? (() => {
            const date = parseLocalDate(
              model.state()[props.endpoint].slice(0, 10)
            );
            return date
              ? new Intl.DateTimeFormat(formatLocale(), {
                  month: 'short',
                  day: 'numeric',
                }).format(date)
              : '';
          })()
        : whenDateLabel(model.state()[props.endpoint], formatLocale())}
    </Button>
  );
}
