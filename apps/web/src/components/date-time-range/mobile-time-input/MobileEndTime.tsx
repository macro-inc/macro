import { t } from '@app/lib/i18n';
import { createUniqueId, Show } from 'solid-js';
import { useDateTimeRange } from '../date-time-range-context';
import { createEndTimeField } from '../primitives/create-end-time-field';
import { MobileTimeInput } from './MobileTimeInput';

export function MobileEndTime() {
  const range = useDateTimeRange();
  const id = createUniqueId();
  const field = createEndTimeField(range);
  return (
    <Show when={!range.allDay}>
      <MobileTimeInput
        id={`mobile-end-time-${id}`}
        label={t('common.endTimeField', { subject: range.subject })}
        date={(field.anchor() ?? range.end).slice(0, 10)}
        value={field.value()}
        timeFormat={range.timeFormat}
        options={field.options()}
        selectedId={field.selectedId()}
        onChange={field.onChange}
        disabled={range.endDisabled}
        invalid={range.invalid}
        describedBy={range.describedBy}
      />
    </Show>
  );
}
