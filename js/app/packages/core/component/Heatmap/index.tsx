import { Popover } from '@kobalte/core/popover';
import { cn, Surface } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

export type HeatmapViewMode = 'all' | 'year' | 'month';

const WEEKS_IN_YEAR = 53;

function getDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getYearGrid(): Date[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const grid: Date[][] = [];
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - WEEKS_IN_YEAR * 7 + (7 - today.getDay()));

  for (let week = 0; week < WEEKS_IN_YEAR; week++) {
    const weekDates: Date[] = [];
    for (let day = 0; day < 7; day++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + week * 7 + day);
      weekDates.push(date);
    }
    grid.push(weekDates);
  }

  return grid;
}

function getThisMonthGrid(): { month: string; year: number; weeks: Date[][] } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthName = monthDate.toLocaleDateString('en', { month: 'long' });
  const year = monthDate.getFullYear();

  const daysInMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0
  ).getDate();
  const firstDayOfWeek = monthDate.getDay();

  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];

  for (let d = 0; d < firstDayOfWeek; d++) {
    currentWeek.push(null as any);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), d);
    currentWeek.push(date);

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null as any);
    }
    weeks.push(currentWeek);
  }

  return { month: monthName, year, weeks };
}

export interface HeatmapDataItem {
  date: Date;
  count: number;
  metadata?: Record<string, any>;
}

export interface HeatmapProps {
  data: HeatmapDataItem[];
  view?: HeatmapViewMode;
  onViewChange?: (view: HeatmapViewMode) => void;
  onDayClick?: (date: Date, data: HeatmapDataItem | undefined) => void;
  renderPopover?: (
    date: Date,
    data: HeatmapDataItem | undefined
  ) => JSX.Element;
  class?: string;
  showViewToggle?: boolean;
  showLegend?: boolean;
  showDayLabels?: boolean;
}

export function Heatmap(props: HeatmapProps) {
  const [internalView, setInternalView] = createSignal<HeatmapViewMode>(
    props.view ?? 'year'
  );

  const view = () => props.view ?? internalView();
  const setView = (v: HeatmapViewMode) => {
    setInternalView(v);
    props.onViewChange?.(v);
  };

  const yearGrid = getYearGrid();
  const thisMonth = getThisMonthGrid();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dataByDay = createMemo(() => {
    const map: Record<string, HeatmapDataItem> = {};
    for (const item of props.data) {
      const date = new Date(item.date);
      date.setHours(0, 0, 0, 0);
      const key = getDateKey(date);
      if (!map[key]) {
        map[key] = { date, count: 0 };
      }
      map[key].count += item.count;
      if (item.metadata) {
        map[key].metadata = { ...map[key].metadata, ...item.metadata };
      }
    }
    return map;
  });

  const maxCount = createMemo(() => {
    const counts = Object.values(dataByDay()).map((d) => d.count);
    return Math.max(...counts, 1);
  });

  const allTimeGrid = createMemo(() => {
    if (props.data.length === 0) return yearGrid;

    let earliest = new Date();
    for (const item of props.data) {
      const d = new Date(item.date);
      if (d < earliest) earliest = d;
    }
    earliest.setHours(0, 0, 0, 0);

    const startDate = new Date(earliest);
    startDate.setDate(earliest.getDate() - earliest.getDay());

    const grid: Date[][] = [];
    const current = new Date(startDate);
    while (current <= today || current.getDay() !== 0) {
      const week: Date[] = [];
      for (let day = 0; day < 7; day++) {
        week.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      grid.push(week);
      if (current > today && current.getDay() === 0) break;
    }

    return grid;
  });

  const getIntensity = (count: number): string => {
    if (count === 0) return 'bg-ink/[0.06]';
    const ratio = count / maxCount();
    if (ratio > 0.75) return 'bg-accent';
    if (ratio > 0.5) return 'bg-accent/70';
    if (ratio > 0.25) return 'bg-accent/50';
    return 'bg-accent/30';
  };

  const DayCell = (cellProps: { date: Date }) => {
    const key = getDateKey(cellProps.date);
    const dayData = () => dataByDay()[key];
    const count = () => dayData()?.count ?? 0;
    const isToday = cellProps.date.getTime() === today.getTime();
    const isFuture = cellProps.date > today;

    const handleClick = () => {
      props.onDayClick?.(cellProps.date, dayData());
    };

    const cellContent = (
      <div
        class={cn(
          'size-2.5 rounded-[1px]',
          isFuture ? 'bg-transparent' : getIntensity(count()),
          isToday && 'ring-1 ring-ink/50',
          'cursor-pointer hover:ring-1 hover:ring-accent/50'
        )}
        onClick={handleClick}
      />
    );

    if (!props.renderPopover) return cellContent;

    return (
      <Popover placement="top" gutter={10} overflowPadding={8} slide>
        <Popover.Trigger as="div">{cellContent}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="z-action-menu animate-in fade-in-0 zoom-in-95 origin-[var(--kb-popover-content-transform-origin)]">
            <Surface class="w-52 overflow-hidden" depth={3}>
              {props.renderPopover(cellProps.date, dayData())}
            </Surface>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    );
  };

  const PLACEHOLDER_WEEK: (Date | null)[] = Array(7).fill(null);

  const monthGridPadded = createMemo(() => {
    const padded: (Date | null)[][] = [...thisMonth.weeks];
    while (padded.length < WEEKS_IN_YEAR) padded.push(PLACEHOLDER_WEEK);
    return padded;
  });

  const activeGrid = createMemo(() => {
    const v = view();
    if (v === 'all') return allTimeGrid();
    if (v === 'month') return monthGridPadded();
    return yearGrid;
  });

  const monthMarkers = createMemo(() => {
    const g = activeGrid();
    const markers: { label: string; row: number }[] = [];
    let last = '';
    g.forEach((week, i) => {
      const d = week[0];
      if (!d) return;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (key !== last) {
        last = key;
        const monthStr = d.toLocaleDateString('en', { month: 'short' });
        const showYear = view() === 'all' && d.getMonth() === 0;
        markers.push({
          label: showYear
            ? `${monthStr} '${String(d.getFullYear()).slice(2)}`
            : monthStr,
          row: i,
        });
      }
    });
    return markers;
  });

  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div class={cn('flex flex-col gap-3', props.class)}>
      <Show when={props.showViewToggle !== false}>
        <div class="flex items-center gap-1 bg-ink/5 rounded-md p-0.5 self-end">
          <For each={['all', 'year', 'month'] as const}>
            {(mode) => (
              <button
                type="button"
                onClick={() => setView(mode)}
                class={cn(
                  'px-2 py-0.5 text-xs rounded capitalize',
                  view() === mode
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-ink-muted'
                )}
              >
                {mode}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="flex flex-col gap-1.5">
        <Show when={props.showDayLabels !== false}>
          <div class="grid grid-cols-[auto_repeat(7,_1fr)] gap-[2px]">
            <div class="w-7" />
            <For each={DAY_LABELS}>
              {(d) => (
                <div class="text-center text-[8px] text-ink-extra-muted leading-none">
                  {d}
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="relative">
          <div class="grid grid-cols-[auto_repeat(7,_1fr)] gap-[2px]">
            <For each={activeGrid()}>
              {(week, weekIdx) => {
                const marker = () =>
                  monthMarkers().find((m) => m.row === weekIdx());
                return (
                  <>
                    <div class="w-7 flex items-center justify-end pr-1">
                      <Show when={marker()}>
                        <span class="text-[8px] text-ink-extra-muted leading-none">
                          {marker()!.label}
                        </span>
                      </Show>
                    </div>
                    <For each={week}>
                      {(date) => {
                        if (!date)
                          return (
                            <div
                              class="size-2.5 rounded-[1px] opacity-[0.07]"
                              style={{
                                'background-image':
                                  'repeating-linear-gradient(135deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 4px)',
                              }}
                            />
                          );
                        return <DayCell date={date} />;
                      }}
                    </For>
                  </>
                );
              }}
            </For>
          </div>
        </div>

        <Show when={props.showLegend !== false}>
          <div class="flex items-center gap-1 text-[8px] text-ink-extra-muted">
            <span>Less</span>
            <div class="flex gap-[2px]">
              <div class="size-1.5 rounded-[1px] bg-ink/[0.06]" />
              <div class="size-1.5 rounded-[1px] bg-accent/30" />
              <div class="size-1.5 rounded-[1px] bg-accent/50" />
              <div class="size-1.5 rounded-[1px] bg-accent/70" />
              <div class="size-1.5 rounded-[1px] bg-accent" />
            </div>
            <span>More</span>
          </div>
        </Show>
      </div>
    </div>
  );
}

export { getDateKey };
