import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { CellDatePicker, datePickerKeyDay } from '../components/CellDatePicker';
import { typedDayText } from '../core/cell-dates';

/**
 * A cell editor's `@` menu that enters dates as typed date text, so a cell
 * holding only a picked date commits as a date value, as if it were typed.
 * `@date` shows a calendar in place of the menu.
 */
export function DateMentionMenu(props: {
  menu: { searchTerm: () => string; closeMenu: () => void };
  anchor: HTMLElement;
  pick: (text: string) => void;
  children: (pickDate: (day: Date) => void) => JSX.Element;
}) {
  // Commits read typed numeric dates in the browser locale's order.
  const pickDate = (day: Date) => {
    const text = typedDayText(day, navigator.language);
    if (text) props.pick(text);
  };
  return (
    <Show
      when={props.menu.searchTerm().trim().toLowerCase() === 'date'}
      fallback={props.children(pickDate)}
    >
      <MentionDatePicker
        anchor={props.anchor}
        onPick={pickDate}
        onClose={props.menu.closeMenu}
      />
    </Show>
  );
}

/**
 * The `@date` calendar. The editor keeps focus and its draft, so this takes
 * the calendar's keys before the editor does: arrows and Page Up/Down move the
 * day from today, Enter picks it and Escape closes the calendar.
 */
function MentionDatePicker(props: {
  anchor: HTMLElement;
  onPick: (day: Date) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const [day, setDay] = createSignal(
    new Date(now.getFullYear(), now.getMonth(), now.getDate())
  );
  onMount(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const next = datePickerKeyDay(event, day());
      if (next) setDay(next);
      else if (event.key === 'Enter') props.onPick(day());
      else if (event.key === 'Escape') props.onClose();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('keydown', keyDown, true);
    onCleanup(() => document.removeEventListener('keydown', keyDown, true));
  });
  return (
    <CellDatePicker
      anchor={props.anchor}
      day={day()}
      onDayChange={setDay}
      onPick={props.onPick}
      onDismiss={props.onClose}
    />
  );
}
