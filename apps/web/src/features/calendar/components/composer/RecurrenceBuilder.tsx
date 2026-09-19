import { RadioGroup } from '@kobalte/core/radio-group';
import { Button, Select } from '@ui';
import { addMonths, format } from 'date-fns';
import { createMemo, For, Show } from 'solid-js';
import {
  buildRecurrenceLines,
  formatRecurrenceDescription,
  type RecurrenceConfig,
  type RecurrenceFrequency,
  WEEKDAY_CODES,
  type WeekdayCode,
} from '../../utils/recurrence';
import { EventDateField } from './EventDateTimeInputs';

const DATE_VALUE = 'yyyy-MM-dd';

type FrequencyOption = {
  value: RecurrenceFrequency;
  label: string;
};

const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { value: 'DAILY', label: 'day' },
  { value: 'WEEKLY', label: 'week' },
  { value: 'MONTHLY', label: 'month' },
  { value: 'YEARLY', label: 'year' },
];

export interface RecurrenceBuilderProps {
  value: RecurrenceConfig;
  start: Date;
  allDay: boolean;
  disabled?: boolean;
  onChange: (value: RecurrenceConfig) => void;
}

/** Builds an RFC 5545 recurrence rule from individually editable parts. */
export function RecurrenceBuilder(props: RecurrenceBuilderProps) {
  const selectedFrequency = createMemo(
    () =>
      FREQUENCY_OPTIONS.find(
        (option) => option.value === props.value.frequency
      ) ?? FREQUENCY_OPTIONS[0]
  );
  const fallbackEndDate = () => format(addMonths(props.start, 3), DATE_VALUE);
  const recurrenceDescription = createMemo(
    () =>
      formatRecurrenceDescription(
        buildRecurrenceLines(props.value, props.allDay)
      ) ?? 'Recurring event'
  );

  const patchConfig = (patch: Partial<RecurrenceConfig>) =>
    props.onChange({ ...props.value, ...patch });
  const setEnds = (ends: RecurrenceConfig['ends']) => patchConfig({ ends });
  const toggleWeekday = (code: WeekdayCode) =>
    patchConfig({
      byDay: props.value.byDay.includes(code)
        ? props.value.byDay.filter((day) => day !== code)
        : [...props.value.byDay, code],
    });
  const changeEndsKind = (kind: string) => {
    if (props.disabled) return;
    switch (kind) {
      case 'never':
        setEnds({ kind: 'never' });
        return;
      case 'on':
        setEnds({
          kind: 'on',
          date:
            props.value.ends.kind === 'on'
              ? props.value.ends.date
              : fallbackEndDate(),
        });
        return;
      case 'after':
        setEnds({
          kind: 'after',
          count:
            props.value.ends.kind === 'after' ? props.value.ends.count : 13,
        });
    }
  };

  return (
    <div class="flex flex-col gap-4 text-xs text-ink-muted">
      <p class="text-sm font-medium text-ink">{recurrenceDescription()}</p>

      <div class="flex flex-wrap items-start gap-4">
        <div class="flex flex-col gap-2">
          <span class="text-ink-extra-muted">Repeat every</span>
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <input
              type="number"
              min="1"
              value={props.value.interval}
              onInput={(event) =>
                patchConfig({ interval: event.currentTarget.valueAsNumber })
              }
              aria-label="Repeat interval"
              class="settings-input h-7 w-16"
              disabled={props.disabled}
            />
            <Select<FrequencyOption>
              options={FREQUENCY_OPTIONS}
              value={selectedFrequency()}
              onChange={(option) =>
                option && patchConfig({ frequency: option.value })
              }
              optionValue="value"
              optionTextValue="label"
              disabled={props.disabled}
            >
              <Select.Trigger
                aria-label="Repeat unit"
                class="settings-input h-7 w-28"
              >
                <Select.Value<FrequencyOption>>
                  {(selectState) => selectState.selectedOption().label}
                </Select.Value>
                <Select.Icon />
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
            </Select>
          </div>
        </div>

        <Show when={props.value.frequency === 'WEEKLY'}>
          <div class="flex flex-col gap-2">
            <span class="text-ink-extra-muted">Repeat on</span>
            <div class="flex flex-wrap items-center gap-1.5">
              <For each={WEEKDAY_CODES}>
                {(code) => (
                  <Button
                    type="button"
                    variant={
                      props.value.byDay.includes(code) ? 'accent' : 'ghost'
                    }
                    size="icon-sm"
                    class="rounded-full text-xxs"
                    aria-label={code}
                    aria-pressed={props.value.byDay.includes(code)}
                    disabled={props.disabled}
                    onClick={() => toggleWeekday(code)}
                  >
                    {code[0]}
                  </Button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-ink-extra-muted">Ends</span>
        <RadioGroup
          value={props.value.ends.kind}
          onChange={changeEndsKind}
          disabled={props.disabled}
          aria-label="Recurrence ends"
          class="grid min-w-0 grid-cols-3 gap-2"
        >
          <RadioGroup.Item
            value="never"
            class="min-w-0 rounded-lg border border-edge-muted bg-surface p-3 data-checked:border-accent data-checked:bg-accent-bg/40"
            onClick={() => changeEndsKind('never')}
          >
            <div class="flex flex-wrap items-center gap-2">
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="flex size-4 shrink-0 items-center justify-center rounded-full border border-edge data-checked:border-accent">
                <RadioGroup.ItemIndicator class="size-2 rounded-full bg-accent" />
              </RadioGroup.ItemControl>
              <RadioGroup.ItemLabel class="shrink-0 font-medium text-ink">
                Never
              </RadioGroup.ItemLabel>
              <span class="text-ink-extra-muted">
                The event repeats indefinitely.
              </span>
            </div>
          </RadioGroup.Item>

          <RadioGroup.Item
            value="on"
            class="min-w-0 rounded-lg border border-edge-muted bg-surface p-3 data-checked:border-accent data-checked:bg-accent-bg/40"
            onClick={() => changeEndsKind('on')}
          >
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="flex size-4 shrink-0 items-center justify-center rounded-full border border-edge data-checked:border-accent">
                <RadioGroup.ItemIndicator class="size-2 rounded-full bg-accent" />
              </RadioGroup.ItemControl>
              <RadioGroup.ItemLabel class="shrink-0 font-medium text-ink">
                On
              </RadioGroup.ItemLabel>
              <EventDateField
                label="Ends on"
                value={
                  props.value.ends.kind === 'on'
                    ? props.value.ends.date
                    : fallbackEndDate()
                }
                onChange={(date) => setEnds({ kind: 'on', date })}
                disabled={props.disabled}
                portalScope="local"
                appearance="bare"
                class="min-h-7 rounded-lg px-2 hover:bg-hover"
              />
            </div>
          </RadioGroup.Item>

          <RadioGroup.Item
            value="after"
            class="min-w-0 rounded-lg border border-edge-muted bg-surface p-3 data-checked:border-accent data-checked:bg-accent-bg/40"
            onClick={() => changeEndsKind('after')}
          >
            <div class="flex flex-wrap items-center gap-2">
              <RadioGroup.ItemInput />
              <RadioGroup.ItemControl class="flex size-4 shrink-0 items-center justify-center rounded-full border border-edge data-checked:border-accent">
                <RadioGroup.ItemIndicator class="size-2 rounded-full bg-accent" />
              </RadioGroup.ItemControl>
              <RadioGroup.ItemLabel class="shrink-0 font-medium text-ink">
                After
              </RadioGroup.ItemLabel>
              <input
                type="number"
                min="1"
                value={
                  props.value.ends.kind === 'after'
                    ? props.value.ends.count
                    : 13
                }
                onInput={(event) =>
                  setEnds({
                    kind: 'after',
                    count: event.currentTarget.valueAsNumber,
                  })
                }
                aria-label="Ends after occurrences"
                class="settings-input h-7 w-14"
                disabled={props.disabled}
              />
              <span>occurrences</span>
            </div>
          </RadioGroup.Item>
        </RadioGroup>
      </div>
    </div>
  );
}
