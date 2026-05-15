import { useSplitLayout } from '@app/component/split-layout/layout';
import { useHistoryQuery } from '@queries/history/history';
import { Popover } from '@kobalte/core/popover';
import CheckCircleIcon from '@icon/regular/check-circle.svg';
import ChatCircleIcon from '@icon/regular/chat-circle.svg';
import EnvelopeIcon from '@icon/regular/envelope.svg';
import FileIcon from '@icon/regular/file.svg';
import FolderIcon from '@icon/regular/folder.svg';
import HashIcon from '@icon/regular/hash.svg';
import MagnifyingGlassIcon from '@icon/regular/magnifying-glass.svg';
import ClockIcon from '@icon/regular/clock-counter-clockwise.svg';
import { cn, Surface } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

type ViewMode = 'all' | 'year' | 'month';

const WEEKS_IN_YEAR = 53;

function getDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getYearGrid(): Date[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const grid: Date[][] = [];

  // Start from ~1 year ago, aligned to Sunday
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (WEEKS_IN_YEAR * 7) + (7 - today.getDay()));

  for (let week = 0; week < WEEKS_IN_YEAR; week++) {
    const weekDates: Date[] = [];
    for (let day = 0; day < 7; day++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + (week * 7) + day);
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

  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = monthDate.getDay();

  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];

  // Pad first week
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

  // Pad last week
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null as any);
    }
    weeks.push(currentWeek);
  }

  return { month: monthName, year, weeks };
}

export function ActivityHeatmapSection() {
  const { openWithSplit } = useSplitLayout();
  const historyQuery = useHistoryQuery();
  const [view, setView] = createSignal<ViewMode>('year');

  const yearGrid = getYearGrid();
  const thisMonth = getThisMonthGrid();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const allTimeGrid = createMemo(() => {
    const history = historyQuery.data ?? [];
    if (history.length === 0) return yearGrid;

    let earliest = new Date();
    for (const item of history) {
      if (!item.updatedAt) continue;
      const d = new Date(item.updatedAt);
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

  interface DayActivity {
    total: number;
    types: Record<string, number>;
  }

  const activityByDay = createMemo(() => {
    const history = historyQuery.data ?? [];
    const data: Record<string, DayActivity> = {};

    for (const item of history) {
      if (!item.updatedAt) continue;
      const date = new Date(item.updatedAt);
      date.setHours(0, 0, 0, 0);
      const key = getDateKey(date);
      if (!data[key]) data[key] = { total: 0, types: {} };
      data[key].total += 1;
      const type = item.type ?? 'other';
      data[key].types[type] = (data[key].types[type] || 0) + 1;
    }

    return data;
  });

  const maxActivity = createMemo(() => {
    const counts = Object.values(activityByDay()).map((d) => d.total);
    return Math.max(...counts, 1);
  });

  const getIntensity = (count: number): string => {
    if (count === 0) return 'bg-ink/[0.06]';
    const ratio = count / maxActivity();
    if (ratio > 0.75) return 'bg-accent';
    if (ratio > 0.5) return 'bg-accent/70';
    if (ratio > 0.25) return 'bg-accent/50';
    return 'bg-accent/30';
  };

  const TYPE_CONFIG: Record<string, { label: string; icon: () => JSX.Element }> = {
    document: { label: 'Docs', icon: () => <FileIcon class="size-3" /> },
    chat: { label: 'Chats', icon: () => <ChatCircleIcon class="size-3" /> },
    email: { label: 'Emails', icon: () => <EnvelopeIcon class="size-3" /> },
    task: { label: 'Tasks', icon: () => <CheckCircleIcon class="size-3" /> },
    channel: { label: 'Channels', icon: () => <HashIcon class="size-3" /> },
    project: { label: 'Projects', icon: () => <FolderIcon class="size-3" /> },
  };

  const DayCell = (props: { date: Date; class?: string; children?: JSX.Element }) => {
    const key = getDateKey(props.date);
    const activity = () => activityByDay()[key];
    const count = () => activity()?.total ?? 0;
    const isToday = props.date.getTime() === today.getTime();
    const isFuture = props.date > today;

    return (
      <Popover placement="top" gutter={10} overflowPadding={8} slide>
        <Popover.Trigger
          as="div"
          class={cn(
            props.class ?? 'h-2.5 w-full rounded-[1px]',
            isFuture ? 'bg-transparent' : getIntensity(count()),
            isToday && 'ring-1 ring-ink/50',
            'cursor-pointer hover:ring-1 hover:ring-accent/50'
          )}
        >
          {props.children}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="z-action-menu animate-in fade-in-0 zoom-in-95 origin-[var(--kb-popover-content-transform-origin)]">
            <Surface class="w-52 overflow-hidden" depth={3}>
              <div class="px-3.5 pt-3.5 pb-3">
                <div class="flex items-baseline gap-2">
                  <span class="text-2xl font-bold tabular-nums text-ink">{props.date.getDate()}</span>
                  <span class="text-sm text-ink-muted">
                    {props.date.toLocaleDateString('en', { weekday: 'short', month: 'short' })}
                    {isToday && ' — Today'}
                  </span>
                </div>
                <Show
                  when={count() > 0}
                  fallback={<p class="text-xs text-ink-extra-muted mt-1">No activity</p>}
                >
                  <div class="flex flex-wrap gap-1.5 mt-2">
                    <For each={Object.entries(activity()!.types).sort((a, b) => b[1] - a[1])}>
                      {([type, n]) => {
                        const config = TYPE_CONFIG[type];
                        return (
                          <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-ink/5 text-[11px] text-ink-muted">
                            {config?.icon()}
                            <span class="font-medium text-ink tabular-nums">{n}</span>
                            {config?.label ?? type}
                          </span>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="border-t border-edge-muted px-1.5 py-1.5 flex flex-col">
                <button
                  type="button"
                  onClick={() => openWithSplit({ type: 'component', id: 'search' })}
                  class="flex items-center gap-2 px-2 py-1.5 text-xs text-ink rounded hover:bg-ink/5 transition-colors"
                >
                  <MagnifyingGlassIcon class="size-3.5 text-ink-muted" />
                  Search this day
                </button>
                <button
                  type="button"
                  onClick={() => openWithSplit({ type: 'component', id: 'history' })}
                  class="flex items-center gap-2 px-2 py-1.5 text-xs text-ink rounded hover:bg-ink/5 transition-colors"
                >
                  <ClockIcon class="size-3.5 text-ink-muted" />
                  View history
                </button>
              </div>
            </Surface>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    );
  };

  return (
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-ink">Activity</h2>
        <div class="flex items-center gap-1 bg-ink/5 rounded-md p-0.5">
          <For each={(['all', 'year', 'month'] as const)}>
            {(mode) => (
              <button
                type="button"
                onClick={() => setView(mode)}
                class={cn(
                  'px-2 py-0.5 text-xs rounded capitalize',
                  view() === mode ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'
                )}
              >
                {mode}
              </button>
            )}
          </For>
        </div>
      </div>

      {(() => {
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

        const monthLabels = createMemo(() => {
          const g = activeGrid();
          const weekCount = g.length;
          const result: { label: string; col: number }[] = [];
          let last = '';
          g.forEach((week, i) => {
            const d = week[0];
            if (!d) return;
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            if (key !== last) {
              last = key;
              const monthStr = d.toLocaleDateString('en', { month: 'short' });
              const showYear = view() === 'all' && d.getMonth() === 0;
              const label = showYear ? `${monthStr} '${String(d.getFullYear()).slice(2)}` : monthStr;
              result.push({ label, col: i });
            }
          });
          return result;
        });

        const GRID_HEIGHT = 'calc(7 * 0.625rem + 6 * 2px)';

        return (
          <div class="space-y-1">
            <div class="flex text-[9px] text-ink-muted ml-5 overflow-hidden">
              <Show
                when={view() !== 'month'}
                fallback={<span>{thisMonth.month} {thisMonth.year}</span>}
              >
                <For each={monthLabels()}>
                  {(item, i) => {
                    const weekCount = activeGrid().length;
                    const nextCol = monthLabels()[i() + 1]?.col ?? weekCount;
                    const width = nextCol - item.col;
                    return (
                      <div style={{ width: `${(width / weekCount) * 100}%` }} class="truncate">
                        {item.label}
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>

            <div style={{ height: GRID_HEIGHT }} class="overflow-hidden">
              <div class="flex gap-[3px] h-full">
                <div class="flex flex-col justify-between text-[9px] text-ink-muted pr-0.5 py-px">
                  <span>S</span>
                  <span>T</span>
                  <span>T</span>
                  <span>S</span>
                </div>
                <div class="flex-1 overflow-hidden">
                  <div class="grid gap-[2px] h-full" style={{ 'grid-template-columns': `repeat(${activeGrid().length}, 1fr)` }}>
                    <For each={activeGrid()}>
                      {(week) => (
                        <div class="flex flex-col gap-[2px]">
                          <For each={week}>
                            {(date) => {
                              if (!date) return (
                                <div
                                  class="flex-1 rounded-[1px] opacity-[0.07]"
                                  style={{
                                    'background-image': 'repeating-linear-gradient(135deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 4px)',
                                  }}
                                />
                              );
                              return <DayCell date={date} class="flex-1 rounded-[1px] min-h-0 min-w-0" />;
                            }}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Legend */}
      <div class="flex items-center justify-end gap-1 text-[9px] text-ink-muted">
        <span>Less</span>
        <div class="flex gap-[2px]">
          <div class="size-2 rounded-[1px] bg-ink/[0.06]" />
          <div class="size-2 rounded-[1px] bg-accent/30" />
          <div class="size-2 rounded-[1px] bg-accent/50" />
          <div class="size-2 rounded-[1px] bg-accent/70" />
          <div class="size-2 rounded-[1px] bg-accent" />
        </div>
        <span>More</span>
      </div>
    </section>
  );
}
