import { formatLocale, t } from '@app/lib/i18n';
import { Show } from 'solid-js';
import type { ClockFormat } from '../primitives/clock-format';
import { mobileClockValue } from '../primitives/mobile-clock-value';

export function TimeValue(props: { value: string; timeFormat?: ClockFormat }) {
  const display = () =>
    mobileClockValue(props.value, props.timeFormat, formatLocale());
  return (
    <span class="flex w-full items-center justify-between gap-2 text-left font-normal">
      <span>{display().time || t('common.time')}</span>
      <Show when={display().meridiem}>
        {(period) => <span class="text-ink-muted">{period()}</span>}
      </Show>
    </span>
  );
}
