import { formatDuration } from '@app/components/date-time-range/time-options';
import { timeRangeFromValue } from '@app/components/date-time-range/time-range';
import { t } from '@app/lib/i18n';
import { Dropdown } from '@ui';
import { differenceInMinutes } from 'date-fns';
import { For } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

const DURATIONS = [15, 30, 45, 60, 90, 120];

export function ComposerDuration() {
  const model = useCalendarComposer();
  const minutes = () => {
    const range = timeRangeFromValue(model.state());
    return range ? differenceInMinutes(range.end, range.start) : undefined;
  };
  const label = () => {
    if (model.state().allDay) return t('calendar.allDay');
    const duration = minutes();
    return duration === undefined || duration < 0
      ? '—'
      : formatDuration(duration);
  };
  const choose = (value: string) => {
    if (value === 'all-day') {
      model.controller.setAllDay(true);
      return;
    }
    const duration = DURATIONS.find((minutes) => String(minutes) === value);
    if (duration !== undefined) model.controller.setDuration(duration);
  };
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        aria-label={t('calendar.duration')}
        disabled={
          model.fieldIsDisabled('end') || model.fieldIsDisabled('allDay')
        }
      >
        {label()}
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-36">
        <Dropdown.RadioGroup
          value={model.state().allDay ? 'all-day' : String(minutes())}
          onChange={choose}
        >
          <For each={DURATIONS}>
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
