import { t } from '@app/lib/i18n';
import { TOKENS } from '@core/hotkey/tokens';
import { Hotkey, Input } from '@ui';
import { Show } from 'solid-js';
import { useMonthPicker } from './month-picker-context';

export function MonthPickerDateEntry() {
  const picker = useMonthPicker();
  return (
    <div class="relative min-w-0 flex-1">
      <Input
        type="text"
        variant="value"
        size="md"
        class="rounded-lg text-sm pr-8"
        placeholder={t('calendar.goToDate')}
        aria-label={t('calendar.goToDate')}
        aria-invalid={picker.state.invalidDate || undefined}
        value={picker.state.dateText}
        onInput={(event) => picker.setDateText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.stopPropagation();
          picker.submitDate();
        }}
      />
      <Show when={picker.props.showGoToDateHotkey}>
        <span class="pointer-events-none absolute inset-y-0 right-1.5 flex items-center">
          <Hotkey token={TOKENS.calendar.goToDate} />
        </span>
      </Show>
    </div>
  );
}
