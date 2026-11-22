import { mobileClockValue } from '@app/components/date-time-range/primitives/mobile-clock-value';
import {
  formatDuration,
  splitLocalDateTime,
} from '@app/components/date-time-range/time-options';
import { TimeWheel } from '@app/components/date-time-range/time-wheel/TimeWheel';
import { formatLocale, t } from '@app/lib/i18n';
import { Button } from '@ui';
import { differenceInMinutes, parseISO } from 'date-fns';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { useComposerWhen } from '../../../context/composer-when-context';

type Endpoint = 'start' | 'end';

export function PhoneTimePill(props: { endpoint: Endpoint; controls: string }) {
  const model = useCalendarComposer();
  const when = useComposerWhen();
  const key = () => (props.endpoint === 'start' ? 'start-time' : 'end-time');
  const display = () =>
    mobileClockValue(
      splitLocalDateTime(model.state()[props.endpoint]).time,
      model.range.timeFormat,
      formatLocale()
    );
  return (
    <Button
      variant="value"
      size="field"
      class="w-[110px] justify-start px-3 font-normal"
      classList={{
        'inset-ring-[1.5px] inset-ring-accent': when.state.active === key(),
      }}
      data-phone-time-control={props.endpoint}
      aria-label={t(
        props.endpoint === 'start' ? 'calendar.startTime' : 'calendar.endTime'
      )}
      aria-expanded={when.state.active === key()}
      aria-controls={props.controls}
      disabled={model.fieldIsDisabled(props.endpoint)}
      onClick={() => when.toggle(key())}
    >
      <span class="flex w-full justify-between">
        <span>{display().time}</span>
        <span>{display().meridiem}</span>
      </span>
    </Button>
  );
}

export function PhoneTimeWheels(props: { endpoint: Endpoint }) {
  const model = useCalendarComposer();
  const when = useComposerWhen();
  const duration = () => {
    if (props.endpoint !== 'end') return undefined;
    const minutes = differenceInMinutes(
      parseISO(model.state().end),
      parseISO(model.state().start)
    );
    return Number.isFinite(minutes) && minutes >= 0
      ? formatDuration(minutes)
      : undefined;
  };
  return (
    <div data-phone-time-wheels="">
      <TimeWheel
        label={t(
          props.endpoint === 'start' ? 'calendar.startTime' : 'calendar.endTime'
        )}
        value={splitLocalDateTime(model.state()[props.endpoint]).time}
        format={model.range.timeFormat}
        disabled={model.fieldIsDisabled(props.endpoint)}
        duration={duration()}
        onChange={(time) => when.chooseWheelTime(props.endpoint, time)}
      />
    </div>
  );
}
