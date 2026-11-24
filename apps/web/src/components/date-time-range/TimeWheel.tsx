import { formatLocale, t } from '@app/lib/i18n';
import { createMemo, Show } from 'solid-js';
import {
  WheelColumn,
  WheelPicker,
} from '../app/mobile/wheel-picker/WheelPicker';
import type { ClockFormat } from './clock-format';
import { mobileClockValue } from './mobile-clock-value';
import {
  timeFromWheelParts,
  timeWheelHours,
  timeWheelMinutes,
  timeWheelParts,
} from './time-wheel';

/** Locale-aware clock columns; the caller owns dates, range policy and validation. */
export function TimeWheel(props: {
  value: string;
  onChange: (time: string) => void;
  format?: ClockFormat;
  disabled?: boolean;
  duration?: string;
  label: string;
}) {
  const twelveHour = createMemo(() =>
    props.format
      ? props.format === '12-hour'
      : new Intl.DateTimeFormat(formatLocale(), {
          hour: 'numeric',
        }).resolvedOptions().hour12 === true
  );
  const hours = createMemo(() => timeWheelHours(twelveHour()));
  const minute = () => Number(props.value.slice(3, 5));
  const minutes = createMemo(() => timeWheelMinutes(minute()));
  const parts = () => timeWheelParts(props.value);
  const periods = createMemo(() =>
    ['am', 'pm'].map((value) => ({
      value,
      label: mobileClockValue(
        value === 'am' ? '01:00' : '13:00',
        '12-hour',
        formatLocale()
      ).meridiem,
    }))
  );
  const change = (field: 'hour' | 'minute' | 'period', value: string) => {
    if (props.disabled) return;
    const next = { ...parts(), [field]: value };
    if (field === 'hour') next.period = Number(value) < 12 ? 'am' : 'pm';
    props.onChange(timeFromWheelParts(next, twelveHour()));
  };
  return (
    <WheelPicker label={props.label} trailingLabel={props.duration}>
      <WheelColumn
        label={t('calendar.wheelHour')}
        width={64}
        loop
        options={hours()}
        value={parts().hour}
        disabled={props.disabled}
        onChange={(value) => change('hour', value)}
      />
      <WheelColumn
        label={t('calendar.wheelMinute')}
        width={64}
        loop
        options={minutes()}
        value={parts().minute}
        disabled={props.disabled}
        onChange={(value) => change('minute', value)}
      />
      <Show when={twelveHour()}>
        <WheelColumn
          label={t('calendar.wheelPeriod')}
          width={64}
          options={periods()}
          value={parts().period}
          disabled={props.disabled}
          onChange={(value) => change('period', value)}
        />
      </Show>
    </WheelPicker>
  );
}
