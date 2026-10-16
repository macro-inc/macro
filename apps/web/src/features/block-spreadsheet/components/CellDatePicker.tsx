import Calendar from '@corvu/calendar';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import { Index } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createTouchPress } from '../primitives/create-touch-press';
import { EditorPopup } from './EditorPopup';

const monthLabel = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
}).format;
const weekdayLong = new Intl.DateTimeFormat('en-US', { weekday: 'long' })
  .format;
const weekdayNarrow = new Intl.DateTimeFormat('en-US', { weekday: 'narrow' })
  .format;
const dayLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'full' }).format;
const DAY_KEYS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/** `day` moved by days, or by months to the same day or the month's last. */
function moveDay(day: Date, days: number, months = 0) {
  const last = new Date(day.getFullYear(), day.getMonth() + months + 1, 0);
  return new Date(
    last.getFullYear(),
    last.getMonth(),
    Math.min(day.getDate(), last.getDate()) + days
  );
}

/**
 * The day a key moves the date picker to: arrows by a day or a week, Page Up
 * and Page Down by a month, or by a year with Shift.
 */
export function datePickerKeyDay(
  event: KeyboardEvent,
  day: Date
): Date | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'PageUp' || event.key === 'PageDown')
    return moveDay(
      day,
      0,
      (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)
    );
  const days = DAY_KEYS[event.key];
  if (event.shiftKey || days === undefined) return;
  return moveDay(day, days);
}

/**
 * A calendar beside a date cell's editor. The editor keeps focus, so the grid
 * moves `day` with the keyboard; pressing a day picks it.
 */
export function CellDatePicker(props: {
  anchor: HTMLElement;
  /** The day the cell holds. */
  value?: Date;
  /** The day the keyboard moves and Enter picks. */
  day: Date;
  onDayChange: (day: Date) => void;
  onPick: (day: Date) => void;
  onDismiss: () => void;
}) {
  const navigation =
    'flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink touch:size-10';
  return (
    <Portal>
      <EditorPopup
        anchor={props.anchor}
        interactive
        class="w-64 p-2 touch:w-80"
        onOutsidePress={props.onDismiss}
      >
        <Calendar
          mode="single"
          value={props.value ?? null}
          month={new Date(props.day.getFullYear(), props.day.getMonth(), 1)}
          focusedDay={props.day}
          startOfWeek={0}
          fixedWeeks
        >
          {(calendar) => (
            <div data-cell-date-picker>
              <div class="flex items-center gap-0.5">
                <Calendar.Label class="min-w-0 flex-1 truncate px-1 text-xs font-medium">
                  {monthLabel(calendar.month)}
                </Calendar.Label>
                <button
                  {...createTouchPress(() =>
                    props.onDayChange(moveDay(props.day, 0, -1))
                  )}
                  type="button"
                  tabIndex={-1}
                  aria-label="Previous month"
                  class={navigation}
                >
                  <CaretLeft class="size-3" />
                </button>
                <button
                  {...createTouchPress(() =>
                    props.onDayChange(moveDay(props.day, 0, 1))
                  )}
                  type="button"
                  tabIndex={-1}
                  aria-label="Next month"
                  class={navigation}
                >
                  <CaretRight class="size-3" />
                </button>
              </div>
              <Calendar.Table class="mt-1 w-full table-fixed border-collapse">
                <thead>
                  <tr>
                    <Index each={calendar.weekdays}>
                      {(weekday) => (
                        <Calendar.HeadCell
                          abbr={weekdayLong(weekday())}
                          class="h-7 text-center text-[10px] font-medium text-ink-extra-muted"
                        >
                          {weekdayNarrow(weekday())}
                        </Calendar.HeadCell>
                      )}
                    </Index>
                  </tr>
                </thead>
                <tbody>
                  <Index each={calendar.weeks}>
                    {(week) => (
                      <tr>
                        <Index each={week()}>
                          {(day) => {
                            const press = createTouchPress(() =>
                              props.onPick(day())
                            );
                            return (
                              <Calendar.Cell class="p-0 text-center">
                                <Calendar.CellTrigger
                                  {...press}
                                  day={day()}
                                  month={calendar.month}
                                  tabIndex={-1}
                                  data-active={
                                    day().getTime() === props.day.getTime()
                                      ? ''
                                      : undefined
                                  }
                                  class="mx-auto flex size-7 items-center justify-center rounded-md text-xs text-ink-muted hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30 touch:size-10 touch:text-sm data-today:border data-today:border-accent data-today:font-semibold data-active:bg-hover data-active:ring-2 data-active:ring-accent data-active:text-ink data-selected:bg-accent! data-selected:text-surface!"
                                  onClick={(event: MouseEvent) => {
                                    // Corvu skips its own selection.
                                    event.preventDefault();
                                    press.onClick(event);
                                  }}
                                >
                                  {day().getDate()}
                                </Calendar.CellTrigger>
                              </Calendar.Cell>
                            );
                          }}
                        </Index>
                      </tr>
                    )}
                  </Index>
                </tbody>
              </Calendar.Table>
              <span class="sr-only" aria-live="polite">
                {dayLabel(props.day)}
              </span>
            </div>
          )}
        </Calendar>
      </EditorPopup>
    </Portal>
  );
}
