import { formatLocale, t } from '@app/lib/i18n';
import { Button, cn } from '@ui';
import { For } from 'solid-js';
import { useMonthPicker } from './month-picker-context';

export function MonthPickerGrid() {
  const picker = useMonthPicker();
  const years = () => picker.state.mode === 'years';
  const cells = () =>
    Array.from({ length: 12 }, (_, i) =>
      years() ? picker.state.yearPageStart + i : i
    );
  const selected = (value: number) =>
    years()
      ? value === picker.state.year
      : picker.props.value.getFullYear() === picker.state.year &&
        picker.props.value.getMonth() === value;
  const current = (value: number) =>
    years()
      ? value === picker.today.getFullYear()
      : picker.state.year === picker.today.getFullYear() &&
        value === picker.today.getMonth();
  const focused = (value: number) =>
    value === (years() ? picker.state.focusedYear : picker.state.focusedMonth);
  const label = (month: number, style: 'short' | 'long') =>
    new Intl.DateTimeFormat(formatLocale(), { month: style }).format(
      new Date(2000, month, 1)
    );
  const keyDown = (event: KeyboardEvent) => {
    let offset: number | undefined;
    switch (event.key) {
      case 'ArrowLeft':
        offset = -1;
        break;
      case 'ArrowRight':
        offset = 1;
        break;
      case 'ArrowUp':
        offset = -4;
        break;
      case 'ArrowDown':
        offset = 4;
        break;
      case 'Home':
        offset = years()
          ? picker.state.yearPageStart - picker.state.focusedYear
          : -picker.state.focusedMonth;
        break;
      case 'End':
        offset = years()
          ? picker.state.yearPageStart + 11 - picker.state.focusedYear
          : 11 - picker.state.focusedMonth;
        break;
      case 'PageUp':
      case 'PageDown': {
        const direction = event.key === 'PageUp' ? -1 : 1;
        if (years()) picker.pageYears(direction);
        else picker.changeYear(direction * (event.shiftKey ? 10 : 1));
        break;
      }
      case 't':
      case 'T':
        picker.goToToday();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (offset !== undefined) {
      if (years()) picker.moveYearFocus(offset);
      else picker.moveFocus(offset);
    }
    picker.focusGrid();
  };
  return (
    <div
      id={picker.gridId}
      data-month-picker-grid
      role="group"
      aria-label={
        years() ? t('calendar.chooseYear') : t('calendar.chooseMonth')
      }
      class="grid grid-cols-4 gap-1"
      onKeyDown={keyDown}
    >
      <For each={cells()}>
        {(value) => (
          <Button
            variant="ghost"
            appearance="bare"
            size="lg"
            class={cn(
              'h-9 rounded-lg text-sm font-normal hover:bg-hover focus-visible:bg-hover',
              selected(value) && 'bg-selected text-accent font-medium',
              !selected(value) && current(value) && 'text-accent'
            )}
            aria-label={
              years()
                ? String(value)
                : `${label(value, 'long')} ${picker.state.year}`
            }
            aria-current={
              current(value) && !selected(value) ? 'date' : undefined
            }
            aria-pressed={selected(value)}
            tabindex={focused(value) ? 0 : -1}
            onFocus={() =>
              years()
                ? picker.setFocusedYear(value)
                : picker.setFocusedMonth(value)
            }
            onClick={() => {
              if (years()) {
                picker.chooseYear(value);
                picker.focusGrid();
              } else picker.chooseMonth(value);
            }}
          >
            {years() ? value : label(value, 'short')}
          </Button>
        )}
      </For>
    </div>
  );
}
