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
import { Dropdown } from './Dropdown';

const formatMonth = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
}).format;
const formatWeekdayLong = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
}).format;
const formatWeekdayNarrow = new Intl.DateTimeFormat(undefined, {
  weekday: 'narrow',
}).format;

const MONTH_RANGE_YEARS = 100;
const MONTH_OPTION_HEIGHT = 32;

type MonthOption = {
  date: Date;
  label: string;
  value: string;
};

const monthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

function MonthMenu(props: { month: Date; onChange: (month: Date) => void }) {
  const now = new Date();
  const todayMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayValue = monthValue(todayMonth);
  const [hasScrolled, setHasScrolled] = createSignal(false);
  const [todayDirection, setTodayDirection] = createSignal<'up' | 'down'>(
    props.month > todayMonth ? 'up' : 'down'
  );
  const options = createMemo<MonthOption[]>(() => {
    const selectedYear = props.month.getFullYear();
    const todayYear = todayMonth.getFullYear();
    const startYear = Math.min(selectedYear, todayYear) - MONTH_RANGE_YEARS;
    const endYear = Math.max(selectedYear, todayYear) + MONTH_RANGE_YEARS;
    return Array.from(
      { length: (endYear - startYear + 1) * 12 },
      (_, offset) => {
        const date = new Date(startYear, offset, 1);
        return {
          date,
          label: formatMonth(date),
          value: monthValue(date),
        };
      }
    );
  });
  const selectedValue = () => monthValue(props.month);
  const indexFor = (value: string) =>
    options().findIndex((option) => option.value === value);
  const todayIndex = () => indexFor(todayValue);
  let virtualizer: VirtualizerHandle | undefined;
  let initialPositionComplete = false;

  const centeredOffsetFor = (index: number) => {
    if (!virtualizer) return index * MONTH_OPTION_HEIGHT;
    return Math.max(
      0,
      virtualizer.getItemOffset(index) -
        (virtualizer.viewportSize - virtualizer.getItemSize(index)) / 2
    );
  };

  const scrollToToday = () => {
    const index = todayIndex();
    if (index >= 0) virtualizer?.scrollToIndex(index, { align: 'center' });
  };

  onMount(() => {
    let positionedFrame: number | undefined;
    const frame = requestAnimationFrame(() => {
      const selectedIndex = indexFor(selectedValue());
      if (selectedIndex >= 0) {
        virtualizer?.scrollToIndex(selectedIndex, { align: 'center' });
      }
      positionedFrame = requestAnimationFrame(() => {
        initialPositionComplete = true;
      });
    });
    onCleanup(() => {
      cancelAnimationFrame(frame);
      if (positionedFrame !== undefined) cancelAnimationFrame(positionedFrame);
    });
  });

  return (
    <div class="relative">
      <Dropdown.RadioGroup
        value={selectedValue()}
        onChange={(value) => {
          const option = options().find(
            (candidate) => candidate.value === value
          );
          if (option) props.onChange(option.date);
        }}
      >
        <div
          class="h-72 overflow-y-auto overscroll-contain"
          style={{ contain: 'strict' }}
        >
          <Virtualizer
            data={options()}
            itemSize={MONTH_OPTION_HEIGHT}
            onScroll={(offset) => {
              if (!initialPositionComplete) return;

              const currentTodayIndex = todayIndex();
              if (currentTodayIndex >= 0) {
                setTodayDirection(
                  offset > centeredOffsetFor(currentTodayIndex) ? 'up' : 'down'
                );
              }

              if (hasScrolled()) return;
              const selectedIndex = indexFor(selectedValue());
              if (
                selectedIndex >= 0 &&
                Math.abs(offset - centeredOffsetFor(selectedIndex)) > 1
              ) {
                setHasScrolled(true);
              }
            }}
            ref={(handle) => {
              virtualizer = handle;
            }}
          >
            {(option) => (
              <Dropdown.RadioItem
                aria-current={option.value === todayValue ? 'date' : undefined}
                class="h-8 text-xs"
                closeOnSelect
                value={option.value}
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
                <Dropdown.ItemIndicator class="ml-auto">
                  <CheckIcon class="size-3.5 text-accent" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            )}
          </Virtualizer>
        </div>
      </Dropdown.RadioGroup>
      <Show when={hasScrolled()}>
        <div class="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <Dropdown.Item
            class="pointer-events-auto w-auto min-w-16 justify-center rounded-full border border-edge-muted bg-surface px-3 text-xs shadow-menu hover:bg-active data-highlighted:bg-active"
            closeOnSelect={false}
            data-direction={todayDirection()}
            onSelect={scrollToToday}
          >
            <Show
              when={todayDirection() === 'up'}
              fallback={<ArrowDownIcon aria-hidden="true" class="size-3" />}
            >
              <ArrowUpIcon aria-hidden="true" class="size-3" />
            </Show>
            Today
          </Dropdown.Item>
        </div>
      </Show>
    </div>
  );
}

export type CalendarProps = Omit<
  CorvuCalendarRootSingleProps,
  'children' | 'mode'
> & {
  /** Additional classes applied to the calendar container. */
  class?: string;
  /** Optional end-exclusive date range to highlight. */
  highlightedRange?: { start: Date; end: Date };
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
              <Dropdown placement="bottom-start">
                <Dropdown.Trigger
                  aria-label="Choose month"
                  class="h-7 max-w-full min-w-0 justify-start gap-1 border-none bg-transparent px-1 text-xs font-medium text-ink hover:bg-hover"
                >
                  <span class="min-w-0 truncate">
                    {formatMonth(calendar.month)}
                  </span>
                  <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
                </Dropdown.Trigger>
                <Dropdown.Content class="min-w-40 p-1">
                  <MonthMenu
                    month={calendar.month}
                    onChange={calendar.setMonth}
                  />
                </Dropdown.Content>
              </Dropdown>
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
                        <CorvuCalendar.Cell class="p-0 text-center">
                          <CorvuCalendar.CellTrigger
                            day={day()}
                            data-highlighted-range={
                              local.highlightedRange &&
                              day() >= local.highlightedRange.start &&
                              day() < local.highlightedRange.end
                                ? ''
                                : undefined
                            }
                            class="mx-auto flex size-7 items-center justify-center rounded-md text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-30 data-today:font-semibold data-highlighted-range:bg-active data-highlighted-range:text-ink data-selected:bg-accent! data-selected:text-surface!"
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
