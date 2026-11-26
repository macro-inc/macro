import { t } from '@app/lib/i18n';
import { DatePicker, Input, RadioGroup } from '@ui';
import { useCustomRecurrence } from '../../../context/custom-recurrence-context';

export const RECURRENCE_END_LABELS = {
  never: 'calendar.recurrenceNever',
  on: 'calendar.recurrenceOn',
  after: 'calendar.recurrenceAfter',
} as const;
export function RecurrenceEnds() {
  const model = useCustomRecurrence();
  return (
    <RadioGroup
      value={model.input.value.ends.kind}
      onChange={model.ends}
      disabled={model.input.disabled}
      aria-label={t('calendar.recurrenceEnds')}
      class="flex flex-col gap-2"
    >
      <RadioGroup.Item value="never" class="gap-2">
        <RadioGroup.ItemControl />
        <RadioGroup.ItemLabel>
          {t(RECURRENCE_END_LABELS.never)}
        </RadioGroup.ItemLabel>
      </RadioGroup.Item>
      <div class="flex flex-wrap items-center gap-2">
        <RadioGroup.Item value="on" class="gap-2">
          <RadioGroup.ItemControl />
          <RadioGroup.ItemLabel>
            {t(RECURRENCE_END_LABELS.on)}
          </RadioGroup.ItemLabel>
        </RadioGroup.Item>
        <DatePicker
          value={model.endDate()}
          onChange={model.onDate}
          disabled={model.input.disabled}
          aria-label={t('calendar.recurrenceEndDate')}
          size="sm"
        />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <RadioGroup.Item value="after" class="gap-2">
          <RadioGroup.ItemControl />
          <RadioGroup.ItemLabel>
            {t(RECURRENCE_END_LABELS.after)}
          </RadioGroup.ItemLabel>
        </RadioGroup.Item>
        <Input
          type="number"
          min="1"
          value={model.count()}
          disabled={model.input.disabled}
          aria-label={t('calendar.recurrenceEndCount')}
          onInput={(event) =>
            model.afterCount(event.currentTarget.valueAsNumber)
          }
          class="w-16"
          size="sm"
        />
        <span class="text-xs text-ink-muted">
          {t('calendar.recurrenceOccurrences')}
        </span>
      </div>
    </RadioGroup>
  );
}
