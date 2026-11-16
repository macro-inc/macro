import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { For } from 'solid-js';
import { useCustomRecurrence } from '../../../context/custom-recurrence-context';
import { WEEKDAY_CODES } from '../../../utils/recurrence';

export function RecurrenceWeekdays() {
  const model = useCustomRecurrence();
  return (
    <div class="flex flex-col gap-1.5">
      <span class="text-sm text-ink-muted">{t('calendar.repeatOn')}</span>
      <div class="flex flex-wrap gap-1">
        <For each={WEEKDAY_CODES}>
          {(day) => (
            <Button
              type="button"
              variant={
                model.input.value.byDay.includes(day) ? 'accent' : 'secondary'
              }
              size="icon-sm"
              aria-label={day}
              aria-pressed={model.input.value.byDay.includes(day)}
              disabled={model.input.disabled}
              onClick={() => model.toggleDay(day)}
            >
              {day[0]}
            </Button>
          )}
        </For>
      </div>
    </div>
  );
}
