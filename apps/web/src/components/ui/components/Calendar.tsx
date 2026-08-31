import CorvuCalendar, {
  type RootSingleProps as CorvuCalendarRootSingleProps,
} from '@corvu/calendar';
import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import {
  createMemo,
  createSignal,
  Index,
  onCleanup,
  onMount,
  Show,
  splitProps,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { cn } from '../utils/classname';
import { Button } from './Button';
import { Dropdown } from './Dropdown';

const formatWeekdayLong = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
}).format;
const formatWeekdayNarrow = new Intl.DateTimeFormat(undefined, {
  weekday: 'narrow',
}).format;

type HighlightedRange = { start: Date; end: Date };

const isDateInRange = (date: Date, range: HighlightedRange | undefined) =>
  range !== undefined && date >= range.start && date < range.end;

const offsetDate = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const isRangeStart = (date: Date, range: HighlightedRange | undefined) =>
  isDateInRange(date, range) && !isDateInRange(offsetDate(date, -1), range);

const isRangeEnd = (date: Date, range: HighlightedRange | undefined) =>
  isDateInRange(date, range) && !isDateInRange(offsetDate(date, 1), range);

export interface CalendarMonthSelectorProps {
  /** Month currently displayed by the calendar. */
  month: Date;
  /** Displays another month. */
  onChange: (month: Date) => void;
}

export type CalendarProps = Omit<
  CorvuCalendarRootSingleProps,
  'children' | 'mode'
> & {
  /** Additional classes applied to the calendar container. */
  class?: string;
  /** Optional end-exclusive date range to highlight. */
  highlightedRange?: HighlightedRange;
};

/** An accessible, single-date calendar styled with the app's semantic tokens. */
export function Calendar(props: CalendarProps) {
  const [local, calendarProps] = splitProps(props, [
    'class',
    'highlightedRange',
  ]);
  const initialFallbackDate = calendarProps.value ?? new Date();

  return (
    <CorvuCalendar
      mode="single"
      {...calendarProps}
      initialMonth={calendarProps.initialMonth ?? initialFallbackDate}
      initialFocusedDay={calendarProps.initialFocusedDay ?? initialFallbackDate}
    >
      {(calendar) => (
        <div class={cn('w-full min-w-0 text-ink', local.class)}>
          <div class="flex items-center gap-2">
            <CorvuCalendar.Label class="min-w-0 flex-1">
              <CalendarMonthDropdown
                month={calendar.month}
                onChange={calendar.setMonth}
              />
            </CorvuCalendar.Label>
            <div class="ml-auto flex shrink-0 items-center gap-0.5">
              <CorvuCalendar.Nav
                action="prev-month"
                aria-label="Go to previous month"
                class="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring focus-visible:ring-accent"
              >
                <CaretLeftIcon class="size-3" />
              </CorvuCalendar.Nav>
              <CorvuCalendar.Nav
                action="next-month"
                aria-label="Go to next month"
                class="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring focus-visible:ring-accent"
              >
                <CaretRightIcon class="size-3" />
              </CorvuCalendar.Nav>
            </div>
          </div>

          <CorvuCalendar.Table class="mt-2 w-full table-fixed border-collapse">
            <thead>
              <tr>
                <Index each={calendar.weekdays}>
                  {(weekday) => (
                    <CorvuCalendar.HeadCell
                      abbr={formatWeekdayLong(weekday())}
                      class="h-7 text-center text-[10px] font-medium text-ink-extra-muted"
                    >
                      {formatWeekdayNarrow(weekday())}
                    </CorvuCalendar.HeadCell>
                  )}
                </Index>
              </tr>
            </thead>
            <tbody>
              <Index each={calendar.weeks}>
                {(week) => (
                  <tr>
                    <Index each={week()}>
                      {(day) => (
                        <CorvuCalendar.Cell
                          class="p-0 text-center data-highlighted-range:bg-active data-highlighted-range-start:rounded-l-md data-highlighted-range-end:rounded-r-md"
                          data-highlighted-range={
                            isDateInRange(day(), local.highlightedRange)
                              ? ''
                              : undefined
                          }
                          data-highlighted-range-end={
                            isRangeEnd(day(), local.highlightedRange)
                              ? ''
                              : undefined
                          }
                          data-highlighted-range-start={
                            isRangeStart(day(), local.highlightedRange)
                              ? ''
                              : undefined
                          }
                        >
                          <CorvuCalendar.CellTrigger
                            day={day()}
                            month={calendar.month}
                            data-highlighted-range={
                              isDateInRange(day(), local.highlightedRange)
                                ? ''
                                : undefined
                            }
                            class="mx-auto flex size-7 items-center justify-center rounded-md text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-30 data-today:border data-today:border-accent data-today:font-semibold data-highlighted-range:text-ink data-selected:bg-accent! data-selected:text-surface!"
                          >
                            {day().getDate()}
                          </CorvuCalendar.CellTrigger>
                        </CorvuCalendar.Cell>
                      )}
                    </Index>
                  </tr>
                )}
              </Index>
            </tbody>
          </CorvuCalendar.Table>
        </div>
      )}
    </CorvuCalendar>
  );
}

const MONTH_RANGE_YEARS = 100;
const MONTH_OPTION_HEIGHT = 32;
const DRAWER_MONTH_OPTION_HEIGHT = 44;

export const formatCalendarMonth = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
}).format;

type MonthOption = {
  date: Date;
  label: string;
  value: string;
};

type MonthOptionRange = {
  options: MonthOption[];
  startYear: number;
};

export type CalendarMonthMenuProps = CalendarMonthSelectorProps & {
  /** Semantic presentation used for month options. */
  presentation?: 'menu' | 'radio-group';
  /** Action invoked by the drawer's Go To Today button. */
  onToday?: () => void;
};

/** Dropdown presentation for selecting a calendar month. */
function CalendarMonthDropdown(props: CalendarMonthSelectorProps) {
  const [open, setOpen] = createSignal(false);

  const selectMonth = (month: Date) => {
    props.onChange(month);
    setOpen(false);
  };

  return (
    <Dropdown open={open()} onOpenChange={setOpen} placement="bottom-start">
      <Dropdown.Trigger
        aria-label="Choose month"
        class="h-7 max-w-full min-w-0 justify-start gap-1 border-none bg-transparent px-1 text-xs font-medium text-ink hover:bg-hover"
      >
        <span class="min-w-0 truncate">{formatCalendarMonth(props.month)}</span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-40 p-1">
        <CalendarMonthMenu month={props.month} onChange={selectMonth} />
      </Dropdown.Content>
    </Dropdown>
  );
}

const monthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const createMonthOptionRange = (
  selectedMonth: Date,
  todayMonth: Date
): MonthOptionRange => {
  const startYear =
    Math.min(selectedMonth.getFullYear(), todayMonth.getFullYear()) -
    MONTH_RANGE_YEARS;
  const endYear =
    Math.max(selectedMonth.getFullYear(), todayMonth.getFullYear()) +
    MONTH_RANGE_YEARS;

  return {
    startYear,
    options: Array.from(
      { length: (endYear - startYear + 1) * 12 },
      (_, offset) => {
        const date = new Date(startYear, offset, 1);

        return {
          date,
          label: formatCalendarMonth(date),
          value: monthValue(date),
        };
      }
    ),
  };
};

const monthIndex = (month: Date, startYear: number) =>
  (month.getFullYear() - startYear) * 12 + month.getMonth();

/** Virtualized month menu reusable across dropdown and drawer presentations. */
export function CalendarMonthMenu(props: CalendarMonthMenuProps) {
  const now = new Date();
  const todayMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayValue = monthValue(todayMonth);
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const [hasScrolled, setHasScrolled] = createSignal(false);
  const [isTodayVisible, setIsTodayVisible] = createSignal(false);
  const [todayDirection, setTodayDirection] = createSignal<'up' | 'down'>(
    props.month > todayMonth ? 'up' : 'down'
  );
  let initialPositionComplete = false;
  let focusFrame: number | undefined;
  let menu!: HTMLDivElement;

  const range = createMemo(() =>
    createMonthOptionRange(props.month, todayMonth)
  );
  const options = () => range().options;
  const selectedValue = () => monthValue(props.month);
  const optionHeight = () =>
    props.presentation === 'radio-group'
      ? DRAWER_MONTH_OPTION_HEIGHT
      : MONTH_OPTION_HEIGHT;
  const selectedIndex = () => monthIndex(props.month, range().startYear);
  const todayIndex = () => monthIndex(todayMonth, range().startYear);

  const centeredOffset = (index: number) => {
    const handle = virtualizer();
    if (!handle) return index * optionHeight();

    return Math.max(
      0,
      handle.getItemOffset(index) -
        (handle.viewportSize - handle.getItemSize(index)) / 2
    );
  };

  const scrollToIndex = (index: number) => {
    if (index < 0 || index >= options().length) return;
    virtualizer()?.scrollToIndex(index, { align: 'center' });
  };

  const focusIndex = (index: number) => {
    scrollToIndex(index);
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);

    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined;
      menu.querySelector<HTMLElement>(`[data-month-index="${index}"]`)?.focus();
    });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const option = (event.target as Element).closest<HTMLElement>(
      '[data-month-index]'
    );
    if (!option || !menu.contains(option)) return;

    const currentIndex = Number(option.dataset.monthIndex);
    let nextIndex: number | undefined;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = Math.min(options().length - 1, currentIndex + 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = options().length - 1;
    }

    if (nextIndex === undefined) return;

    event.preventDefault();
    focusIndex(nextIndex);
  };

  const handleScroll = (offset: number) => {
    if (!initialPositionComplete) return;

    const handle = virtualizer();
    const currentTodayIndex = todayIndex();

    if (handle) {
      const todayStart = handle.getItemOffset(currentTodayIndex);
      const todayEnd = todayStart + handle.getItemSize(currentTodayIndex);

      setIsTodayVisible(
        todayEnd > offset && todayStart < offset + handle.viewportSize
      );
      setTodayDirection(
        offset > centeredOffset(currentTodayIndex) ? 'up' : 'down'
      );
    }

    if (
      !hasScrolled() &&
      Math.abs(offset - centeredOffset(selectedIndex())) > 1
    ) {
      setHasScrolled(true);
    }
  };

  onMount(() => {
    let positionedFrame: number | undefined;
    const frame = requestAnimationFrame(() => {
      scrollToIndex(selectedIndex());
      positionedFrame = requestAnimationFrame(() => {
        initialPositionComplete = true;
        menu
          .querySelector<HTMLElement>(`[data-month-index="${selectedIndex()}"]`)
          ?.focus({ preventScroll: true });
      });
    });

    onCleanup(() => {
      cancelAnimationFrame(frame);
      if (positionedFrame !== undefined) cancelAnimationFrame(positionedFrame);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    });
  });

  return (
    <div
      ref={menu}
      class="relative"
      role={props.presentation === 'radio-group' ? 'radiogroup' : undefined}
      aria-label={
        props.presentation === 'radio-group' ? 'Choose month' : undefined
      }
      onKeyDown={handleKeyDown}
    >
      <div
        class={cn(
          'h-72 overflow-y-auto overscroll-contain',
          props.presentation === 'radio-group' && 'rounded-2xl'
        )}
        style={{ contain: 'strict' }}
      >
        <Virtualizer
          data={options()}
          itemSize={optionHeight()}
          onScroll={handleScroll}
          ref={setVirtualizer}
        >
          {(option) => {
            const index = () => monthIndex(option.date, range().startYear);
            const selected = () => option.value === selectedValue();

            return (
              <button
                type="button"
                role={
                  props.presentation === 'radio-group'
                    ? 'radio'
                    : 'menuitemradio'
                }
                aria-checked={selected()}
                aria-current={option.value === todayValue ? 'date' : undefined}
                data-month-index={index()}
                class={cn(
                  'flex w-full items-center gap-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover',
                  selected() ? 'text-accent' : 'text-ink',
                  props.presentation === 'radio-group'
                    ? 'relative h-11 bg-surface px-4 text-sm'
                    : 'h-8 rounded-lg px-2 text-xs'
                )}
                tabIndex={selected() ? 0 : -1}
                onClick={() => props.onChange(option.date)}
              >
                <span
                  aria-hidden="true"
                  class="flex size-2 shrink-0 items-center justify-center"
                >
                  <Show when={option.value === todayValue}>
                    <span class="size-1.5 rounded-full bg-accent" />
                  </Show>
                </span>
                <span>{option.label}</span>
                <CheckIcon
                  class="ml-auto size-3.5 text-accent"
                  classList={{ invisible: !selected() }}
                />
                <Show
                  when={
                    props.presentation === 'radio-group' &&
                    index() < options().length - 1
                  }
                >
                  <span
                    aria-hidden="true"
                    class="absolute inset-x-2 bottom-0 h-px bg-edge-muted"
                  />
                </Show>
              </button>
            );
          }}
        </Virtualizer>
      </div>

      <Show when={props.presentation === 'radio-group'}>
        <div class="flex pt-3">
          <Button
            fullWidth
            variant="outline"
            size="sm"
            depth={3}
            class="rounded-full bg-surface px-3 text-ink shadow-menu"
            label="Go To Today"
            onClick={() => {
              if (props.onToday) {
                props.onToday();
                return;
              }
              focusIndex(todayIndex());
            }}
          >
            Go To Today
          </Button>
        </div>
      </Show>

      <Show
        when={
          props.presentation !== 'radio-group' &&
          hasScrolled() &&
          !isTodayVisible()
        }
      >
        <div class="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <button
            type="button"
            class={cn(
              'pointer-events-auto flex min-w-16 items-center justify-center gap-1.5 rounded-full border border-edge-muted bg-surface px-3 text-ink shadow-menu hover:bg-active',
              props.presentation === 'radio-group'
                ? 'h-11 text-sm'
                : 'h-8 text-xs'
            )}
            data-direction={todayDirection()}
            onClick={() => focusIndex(todayIndex())}
          >
            <Show
              when={todayDirection() === 'up'}
              fallback={<ArrowDownIcon aria-hidden="true" class="size-3" />}
            >
              <ArrowUpIcon aria-hidden="true" class="size-3" />
            </Show>
            Today
          </button>
        </div>
      </Show>
    </div>
  );
}
