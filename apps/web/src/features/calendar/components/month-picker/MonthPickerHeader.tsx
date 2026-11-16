import { t } from '@app/lib/i18n';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Button } from '@ui';
import { useMonthPicker } from './month-picker-context';

export function MonthPickerHeader() {
  const picker = useMonthPicker();
  return (
    <div class="flex items-center gap-1">
      <span
        class="flex-1 text-sm font-semibold tabular-nums"
        aria-live="polite"
      >
        {picker.state.year}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('calendar.previousYear')}
        onClick={() => picker.changeYear(-1)}
      >
        <CaretLeftIcon class="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('calendar.nextYear')}
        onClick={() => picker.changeYear(1)}
      >
        <CaretRightIcon class="size-4" />
      </Button>
    </div>
  );
}
