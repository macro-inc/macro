import { formatDuration } from '@app/components/date-time-range/time-options';
import { timeRangeFromValue } from '@app/components/date-time-range/time-range';
import { t } from '@app/lib/i18n';
import { Dropdown } from '@ui';
import { differenceInMinutes } from 'date-fns';
import { For } from 'solid-js';
import { useEventForm } from '../../../context/event-form-context';

const DURATION_CHOICES = [15, 30, 45, 60, 90, 120];

/** A plain duration value; its menu also owns the all-day choice. */
export function EventDuration() {
  const form = useEventForm();
  const minutes = () => {
    const range = timeRangeFromValue(form.state());
    return range ? differenceInMinutes(range.end, range.start) : undefined;
  };
  const label = () => {
    if (form.state().allDay) return t('calendar.allDay');
    const duration = minutes();
    if (duration === undefined || duration < 0) return '—';
    return formatDuration(duration);
  };
  const changeDuration = (value: string) => {
    if (value === 'all-day') {
      form.controller.setAllDay(true);
      return;
    }
    const duration = DURATION_CHOICES.find(
      (minutes) => String(minutes) === value
    );
    if (duration !== undefined) form.controller.setDuration(duration);
  };

  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        aria-label={t('calendar.duration')}
        disabled={form.fieldIsDisabled('end') || form.fieldIsDisabled('allDay')}
      >
        {label()}
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-36">
        <Dropdown.RadioGroup
          value={form.state().allDay ? 'all-day' : String(minutes())}
          onChange={changeDuration}
        >
          <For each={DURATION_CHOICES}>
            {(duration) => (
              <Dropdown.RadioItem value={String(duration)} closeOnSelect>
                <span class="flex-1">{formatDuration(duration)}</span>
                <Dropdown.ItemIndicator />
              </Dropdown.RadioItem>
            )}
          </For>
          <Dropdown.RadioItem value="all-day" closeOnSelect>
            <span class="flex-1">{t('calendar.allDay')}</span>
            <Dropdown.ItemIndicator />
          </Dropdown.RadioItem>
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}
