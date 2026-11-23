import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Button } from '@ui';
import { useMonthPicker } from './month-picker-context';

export function MonthPickerHeader() {
  const picker = useMonthPicker();
  const years = () => picker.state.mode === 'years';
  const page = (direction: number) => {
    if (years()) picker.pageYears(direction);
    else picker.changeYear(direction);
  };
  return (
    <div class="flex h-8 items-center gap-1">
      <Button
        variant="value"
        size="md"
        aria-label={t('calendar.chooseYear')}
        aria-expanded={years()}
        aria-controls={picker.gridId}
        classList={{ 'inset-ring-[1.5px] inset-ring-accent': years() }}
        onClick={() => {
          picker.toggleYears();
          picker.focusGrid();
        }}
      >
        <span aria-live="polite">{picker.state.year}</span>
        <CaretDownIcon
          class="size-3.5 text-ink-extra-muted"
          classList={{ 'rotate-180': years() }}
        />
      </Button>
      <span class="sr-only" aria-live="polite">
        {years()
          ? `${picker.state.yearPageStart}–${picker.state.yearPageStart + 11}`
          : ''}
      </span>
      <div class="flex-1" />
      <Button
        variant="ghost"
        size="icon-md"
        aria-label={
          years() ? t('calendar.previousYears') : t('calendar.previousYear')
        }
        onClick={() => page(-1)}
      >
        <CaretLeftIcon class="size-4 text-ink-muted" />
      </Button>
      <Button
        variant="ghost"
        size="icon-md"
        aria-label={years() ? t('calendar.nextYears') : t('calendar.nextYear')}
        onClick={() => page(1)}
      >
        <CaretRightIcon class="size-4 text-ink-muted" />
      </Button>
    </div>
  );
}
