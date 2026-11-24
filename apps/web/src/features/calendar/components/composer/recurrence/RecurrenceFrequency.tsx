import { t } from '@app/lib/i18n';
import { Dropdown, Input } from '@ui';
import { For } from 'solid-js';
import { useCustomRecurrence } from '../../../context/custom-recurrence-context';

export const RECURRENCE_FREQUENCIES = [
  { value: 'DAILY', label: 'calendar.recurrenceDay' },
  { value: 'WEEKLY', label: 'calendar.recurrenceWeek' },
  { value: 'MONTHLY', label: 'calendar.recurrenceMonth' },
  { value: 'YEARLY', label: 'calendar.recurrenceYear' },
] as const;

export function RecurrenceFrequency() {
  const model = useCustomRecurrence();
  const label = () => {
    const frequency = RECURRENCE_FREQUENCIES.find(
      (item) => item.value === model.input.value.frequency
    );
    return t(frequency?.label ?? 'calendar.recurrenceDay');
  };
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-ink-muted">{t('calendar.repeatEvery')}</span>
      <Input
        type="number"
        min="1"
        value={model.input.value.interval}
        disabled={model.input.disabled}
        aria-label={t('calendar.repeatInterval')}
        class="w-16"
        onInput={(event) => model.interval(event.currentTarget.valueAsNumber)}
      />
      <Dropdown placement="bottom-start">
        <Dropdown.Trigger
          variant="value"
          finish="flat"
          size="sm"
          disabled={model.input.disabled}
          aria-label={t('calendar.repeatUnit')}
        >
          {label()}
        </Dropdown.Trigger>
        <Dropdown.Content portalScope="local" class="min-w-32">
          <Dropdown.Group>
            <Dropdown.RadioGroup
              value={model.input.value.frequency}
              onChange={model.frequency}
            >
              <For each={RECURRENCE_FREQUENCIES}>
                {(frequency) => (
                  <Dropdown.RadioItem value={frequency.value} closeOnSelect>
                    <span class="flex-1">{t(frequency.label)}</span>
                    <Dropdown.ItemIndicator />
                  </Dropdown.RadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
