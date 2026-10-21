import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import { Button } from '@ui';
import { addDays, addWeeks, isSameDay, startOfDay } from 'date-fns';
import { For, Show } from 'solid-js';

type DueDateSelectorProps = {
  selectedDate?: Date | null;
  onSelectDate: (date: Date | null) => void;
  onClose?: () => void;
};

/** Shortcut row plus the month, for a due date. Other dates keep the search picker. */
export function DueDateSelector(props: DueDateSelectorProps) {
  const shortcuts = () => {
    const today = startOfDay(new Date());
    return [
      { label: 'Today', date: today },
      { label: 'Tomorrow', date: addDays(today, 1) },
      { label: 'Next week', date: addWeeks(today, 1) },
      { label: 'In 2 weeks', date: addWeeks(today, 2) },
    ];
  };
  const choose = (date: Date | null) => {
    props.onSelectDate(date);
    props.onClose?.();
  };
  const pressed = (date: Date) =>
    props.selectedDate != null && isSameDay(props.selectedDate, date);

  return (
    <div class="w-full">
      <div class="flex flex-nowrap gap-1 px-2 pt-3">
        <For each={shortcuts()}>
          {(shortcut) => (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={pressed(shortcut.date)}
              onClick={() => choose(shortcut.date)}
            >
              {shortcut.label}
            </Button>
          )}
        </For>
      </div>
      <Show when={props.selectedDate != null}>
        <div class="px-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            class="text-failure"
            onClick={() => choose(null)}
          >
            Clear
          </Button>
        </div>
      </Show>
      <DatePickerUI
        class="w-full"
        value={props.selectedDate ?? new Date()}
        onChange={(date) => choose(date)}
      />
    </div>
  );
}
