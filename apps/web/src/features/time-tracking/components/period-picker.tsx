import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Button, Dropdown, SingleSelectCheck } from '@ui';
import { For, type JSX } from 'solid-js';
import { match } from 'ts-pattern';
import { TIME_PERIODS, type TimePeriod } from '../core/time-period';

export function periodLabel(period: TimePeriod): string {
  return match(period)
    .with('this-week', () => t('timeTracking.periodThisWeek'))
    .with('last-week', () => t('timeTracking.periodLastWeek'))
    .with('this-month', () => t('timeTracking.periodThisMonth'))
    .with('last-month', () => t('timeTracking.periodLastMonth'))
    .with('this-year', () => t('timeTracking.periodThisYear'))
    .exhaustive();
}

/** Picks the period a report covers. */
export function PeriodPicker(props: {
  value: TimePeriod;
  onChange(period: TimePeriod): void;
}): JSX.Element {
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        as={Button}
        variant="secondary"
        size="md"
        aria-label={t('timeTracking.periodLabel', {
          period: periodLabel(props.value),
        })}
      >
        <span class="truncate">{periodLabel(props.value)}</span>
        <CaretDownIcon class="size-3 shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-40 max-w-64">
        <Dropdown.Group>
          <For each={TIME_PERIODS}>
            {(period) => (
              <Dropdown.Item onSelect={() => props.onChange(period)}>
                <span class="flex-1 truncate">{periodLabel(period)}</span>
                <SingleSelectCheck active={props.value === period} />
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
