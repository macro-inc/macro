import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { MonthPickerDateEntry } from './MonthPickerDateEntry';
import { useMonthPicker } from './month-picker-context';

export function MonthPickerFooter() {
  const picker = useMonthPicker();
  return (
    <div class="flex h-8 items-center gap-2">
      <Button
        variant="secondary"
        size="md"
        disabled={picker.todayDisabled()}
        onClick={() => {
          picker.goToToday();
          picker.focusGrid();
        }}
      >
        {t('calendar.today')}
      </Button>
      <MonthPickerDateEntry />
    </div>
  );
}
