import { t } from '@app/lib/i18n';
import { addMonths, format } from 'date-fns';
import { createMemo } from 'solid-js';
import {
  buildRecurrenceLines,
  formatRecurrenceDescription,
  type RecurrenceConfig,
  type RecurrenceFrequency,
  type WeekdayCode,
} from '../utils/recurrence';

export interface CustomRecurrenceInput {
  value: RecurrenceConfig;
  start: Date;
  allDay: boolean;
  disabled?: boolean;
  onChange: (value: RecurrenceConfig) => void;
}

const FREQUENCIES: readonly RecurrenceFrequency[] = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
];

export function createCustomRecurrence(input: CustomRecurrenceInput) {
  const patch = (change: Partial<RecurrenceConfig>) => {
    if (!input.disabled) input.onChange({ ...input.value, ...change });
  };
  const endDate = () =>
    input.value.ends.kind === 'on'
      ? input.value.ends.date
      : format(addMonths(input.start, 3), 'yyyy-MM-dd');
  const count = () =>
    input.value.ends.kind === 'after' ? input.value.ends.count : 13;
  return {
    input,
    endDate,
    count,
    description: createMemo(
      () =>
        formatRecurrenceDescription(
          buildRecurrenceLines(input.value, input.allDay)
        ) ?? t('calendar.recurringEvent')
    ),
    interval: (value: number) => patch({ interval: value }),
    frequency: (value: string) => {
      const frequency = FREQUENCIES.find((frequency) => frequency === value);
      if (frequency) patch({ frequency });
    },
    toggleDay: (day: WeekdayCode) =>
      patch({
        byDay: input.value.byDay.includes(day)
          ? input.value.byDay.filter((current) => current !== day)
          : [...input.value.byDay, day],
      }),
    ends: (kind: string) => {
      if (kind === 'never') patch({ ends: { kind } });
      if (kind === 'on') patch({ ends: { kind, date: endDate() } });
      if (kind === 'after') patch({ ends: { kind, count: count() } });
    },
    onDate: (date: string) => patch({ ends: { kind: 'on', date } }),
    afterCount: (count: number) => patch({ ends: { kind: 'after', count } }),
  };
}

export type CustomRecurrenceModel = ReturnType<typeof createCustomRecurrence>;
