import { createUniqueId, onMount, type ParentProps } from 'solid-js';
import { createMonthPicker } from '../../primitives/create-month-picker';
import { MonthPickerFooter } from './MonthPickerFooter';
import { MonthPickerGrid } from './MonthPickerGrid';
import { MonthPickerHeader } from './MonthPickerHeader';
import { MonthPickerContext } from './month-picker-context';

export type MonthYearPickerProps = ParentProps<{
  value: Date;
  onChange: (month: Date) => void;
  onGoToDate?: (date: Date) => void;
  onCancel?: () => void;
  initialFocus?: 'month' | 'goToDate' | 'none';
  showGoToDateHotkey?: boolean;
  today?: Date;
}>;

function MonthYearPickerRoot(props: MonthYearPickerProps) {
  let root!: HTMLDivElement;
  const picker = createMonthPicker({
    value: () => props.value,
    onChange: (date) => props.onChange(date),
    onGoToDate: (date) => props.onGoToDate?.(date),
    today: props.today,
    onReset: () => {
      if (
        root
          ?.querySelector('[data-month-picker-grid]')
          ?.contains(document.activeElement)
      )
        focusGrid();
    },
  });
  const gridId = createUniqueId();
  const focusGrid = () =>
    queueMicrotask(() => {
      if (root.isConnected)
        root
          .querySelector<HTMLElement>('[data-month-picker-grid] [tabindex="0"]')
          ?.focus();
    });
  onMount(() => {
    if (props.initialFocus === 'none') return;
    if (props.initialFocus === 'goToDate')
      root.querySelector<HTMLInputElement>('input')?.focus();
    else focusGrid();
  });
  return (
    <MonthPickerContext.Provider
      value={{ ...picker, props, gridId, focusGrid }}
    >
      <div
        ref={root}
        class="flex flex-col gap-3"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          if (event.target instanceof HTMLInputElement) props.onCancel?.();
          else if (picker.state.mode === 'years') {
            picker.showMonths();
            focusGrid();
          } else props.onCancel?.();
        }}
      >
        {props.children}
      </div>
    </MonthPickerContext.Provider>
  );
}

/** Shared standalone composition; a popover is only one possible host. */
export const MonthYearPicker = Object.assign(MonthYearPickerRoot, {
  Header: MonthPickerHeader,
  Grid: MonthPickerGrid,
  Footer: MonthPickerFooter,
});
