import { t } from '@app/lib/i18n';
import { Input } from '@ui';
import { useMonthPicker } from './month-picker-context';

export function MonthPickerDateEntry() {
  const picker = useMonthPicker();
  return (
    <Input
      type="date"
      aria-label={t('calendar.goToDate')}
      aria-invalid={picker.state.invalidDate || undefined}
      value={picker.state.dateText}
      onInput={(event) => picker.setDateText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        picker.submitDate();
      }}
    />
  );
}
