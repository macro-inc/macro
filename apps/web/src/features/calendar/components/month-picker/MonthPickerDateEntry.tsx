import { t } from '@app/lib/i18n';
import { TOKENS } from '@core/hotkey/tokens';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import { Hotkey, InputGroup } from '@ui';
import { Show } from 'solid-js';
import { useMonthPicker } from './month-picker-context';

export function MonthPickerDateEntry() {
  const picker = useMonthPicker();
  return (
    <InputGroup variant="value" size="md" class="min-w-0 flex-1 rounded-lg">
      <InputGroup.Addon align="inline-start">
        <CalendarBlankIcon class="size-4 text-ink-extra-muted" />
      </InputGroup.Addon>
      <InputGroup.Input
        type="date"
        class="min-w-0 text-sm [&::-webkit-calendar-picker-indicator]:hidden"
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
        <InputGroup.Addon align="inline-end">
          <Hotkey token={TOKENS.calendar.goToDate} />
        </InputGroup.Addon>
      </Show>
    </InputGroup>
  );
}
