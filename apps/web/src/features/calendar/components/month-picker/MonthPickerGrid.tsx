import { formatLocale, t } from '@app/lib/i18n';
import { Button, cn } from '@ui';
import { For } from 'solid-js';
import { useMonthPicker } from './month-picker-context';

export interface MonthPickerGridProps {
  selectedDate: Date;
  columns?: 3 | 4;
}

export function MonthPickerGrid(props: MonthPickerGridProps) {
  const picker = useMonthPicker();
  const months = Array.from({ length: 12 }, (_, month) => month);
  const buttons: HTMLButtonElement[] = [];
  const columns = () => props.columns ?? 4;
  const isSelected = (month: number) =>
    props.selectedDate.getFullYear() === picker.state.year &&
    props.selectedDate.getMonth() === month;
  const monthLabel = (month: number, style: 'short' | 'long') =>
    new Intl.DateTimeFormat(formatLocale(), { month: style }).format(
      new Date(2000, month, 1)
    );

  const move = (event: KeyboardEvent) => {
    let offset: number;
    switch (event.key) {
      case 'ArrowRight':
        offset = 1;
        break;
      case 'ArrowLeft':
        offset = -1;
        break;
      case 'ArrowDown':
        offset = columns();
        break;
      case 'ArrowUp':
        offset = -columns();
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons[picker.moveFocus(offset)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={t('calendar.chooseMonth')}
      class={cn('grid gap-1', columns() === 4 ? 'grid-cols-4' : 'grid-cols-3')}
      onKeyDown={move}
    >
      <For each={months}>
        {(month) => (
          <div
            class={cn(
              'rounded-xl',
              isSelected(month)
                ? 'bg-accent/20 text-accent'
                : 'text-ink hover:bg-hover'
            )}
          >
            <Button
              ref={(element) => {
                buttons[month] = element;
              }}
              variant="ghost"
              appearance="bare"
              size="lg"
              fullWidth
              aria-pressed={isSelected(month)}
              aria-label={`${monthLabel(month, 'long')} ${picker.state.year}`}
              tabIndex={picker.state.focusedMonth === month ? 0 : -1}
              onFocus={() => picker.setFocusedMonth(month)}
              onClick={() => picker.chooseMonth(month)}
            >
              {monthLabel(month, 'short')}
            </Button>
          </div>
        )}
      </For>
    </div>
  );
}
