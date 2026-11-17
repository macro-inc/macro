import { t } from '@app/lib/i18n';
import { createUniqueId, Show } from 'solid-js';
import { useDateTimeRange } from '../date-time-range-context';
import { splitLocalDateTime, withLocalTime } from '../time-options';
import { MobileTimeInput } from './MobileTimeInput';

export function MobileStartTime() {
  const range = useDateTimeRange();
  const id = createUniqueId();
  return (
    <Show when={!range.allDay}>
      <MobileTimeInput
        id={`mobile-start-time-${id}`}
        label={t('common.startTimeField', { subject: range.subject })}
        value={splitLocalDateTime(range.start).time}
        timeFormat={range.timeFormat}
        onChange={(option) =>
          range.onStartChange(withLocalTime(range.start, option.value))
        }
        disabled={range.startDisabled}
        invalid={range.invalid}
        describedBy={range.describedBy}
      />
    </Show>
  );
}
