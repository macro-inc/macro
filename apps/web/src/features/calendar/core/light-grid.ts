import { type SegEntry, SegHierarchy } from '@fullcalendar/core/internal';
import { addDays, isSameDay, parseISO, startOfDay } from 'date-fns';
import type { CalendarEvent } from '../types';

export interface LightCalendarEvent<T = CalendarEvent> {
  event: T;
  start: Date;
  end: Date;
  allDay: boolean;
}
export interface LightTimeBlock<T = CalendarEvent> {
  event: T;
  top: number;
  bottom: number;
  near: number;
  far: number;
  depth: number;
  forward: number;
}
interface LayoutNode {
  entry: SegEntry;
  children: LayoutNode[];
  pressure: number;
}

/** Match the canonical all-day projection without changing event timestamps. */
export function lightCalendarEvents(
  events: readonly CalendarEvent[]
): LightCalendarEvent[] {
  return events
    .flatMap((event) => {
      const start = parseISO(event.start);
      const end = parseISO(event.end);
      if (!Number.isFinite(+start) || !Number.isFinite(+end) || end < start)
        return [];
      const allDay =
        event.allDay ||
        (+end > +start && !isSameDay(start, new Date(+end - 1)));
      return [
        {
          event,
          start: allDay ? startOfDay(start) : start,
          end: allDay ? addDays(startOfDay(new Date(+end - 1)), 1) : end,
          allDay,
        },
      ];
    })
    .sort(
      (a, b) =>
        +a.start - +b.start ||
        +b.end - +b.start - (+a.end - +a.start) ||
        Number(b.allDay) - Number(a.allDay) ||
        a.event.title.localeCompare(b.event.title)
    );
}

export function lightGridDays(start: Date, end: Date, showWeekends: boolean) {
  const days: Date[] = [];
  for (let day = startOfDay(start); day < end; day = addDays(day, 1)) {
    if (showWeekends || (day.getDay() !== 0 && day.getDay() !== 6))
      days.push(day);
  }
  return days;
}

/** Pack the same overlap graph as FullCalendar, retaining its pressure ordering. */
function timeOverlapNodes(entries: SegEntry[]) {
  const hierarchy = new SegHierarchy();
  hierarchy.addSegs(entries);
  const cache = new Map<SegEntry, LayoutNode>();
  const build = (level: number, entry: SegEntry): LayoutNode => {
    const cached = cache.get(entry);
    if (cached) return cached;
    let children: LayoutNode[] = [];
    const after = hierarchy.levelCoords[level] + (entry.thickness ?? 1);
    for (let next = level + 1; next < hierarchy.entriesByLevel.length; next++) {
      if (hierarchy.levelCoords[next] < after) continue;
      const overlaps = hierarchy.entriesByLevel[next].filter(
        (other) =>
          other.span.start < entry.span.end && other.span.end > entry.span.start
      );
      if (overlaps.length) {
        children = overlaps
          .map((other) => build(next, other))
          .sort((a, b) => b.pressure - a.pressure);
        break;
      }
    }
    const node = {
      entry,
      children,
      pressure: (entry.thickness ?? 1) + (children[0]?.pressure ?? 0),
    };
    cache.set(entry, node);
    return node;
  };
  return (hierarchy.entriesByLevel[0] ?? [])
    .map((entry) => build(0, entry))
    .sort((a, b) => b.pressure - a.pressure);
}

export function lightTimeBlocks<T>(
  events: readonly LightCalendarEvent<T>[],
  day: Date,
  hourHeight: number
): LightTimeBlock<T>[] {
  const nextDay = addDays(day, 1);
  const timed = events.filter(
    (item) =>
      !item.allDay &&
      item.start < nextDay &&
      item.end >= day &&
      (item.end > day || item.start >= day)
  );
  const pixels = (date: Date) => {
    if (date <= day) return 0;
    if (date >= nextDay) return hourHeight * 24;
    return (
      ((date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60) *
        hourHeight) /
      60
    );
  };
  const entries = timed.map((item, index) => {
    const start = Math.round(pixels(item.start));
    return {
      index,
      thickness: 1,
      span: { start, end: Math.round(Math.max(start + 15, pixels(item.end))) },
    };
  });
  const roots = timeOverlapNodes(entries);
  const stretched = new Map<LayoutNode, { near: number; thickness: number }>();
  const stretch = (
    node: LayoutNode,
    start: number,
    previous: number
  ): number => {
    const cached = stretched.get(node);
    if (cached) return cached.near;
    const thickness = node.entry.thickness ?? 1;
    const total = thickness + previous;
    let end = 1;
    node.children.forEach((child, index) => {
      const near = stretch(
        child,
        index === 0 ? start : end,
        index === 0 ? total : 0
      );
      if (index === 0) end = near;
    });
    const width = ((end - start) * thickness) / total;
    stretched.set(node, { near: end - width, thickness: width });
    return end - width;
  };
  roots.forEach((node) => stretch(node, 0, 0));
  const blocks = new Map<LayoutNode, LightTimeBlock<T>>();
  const visit = (node: LayoutNode, near: number, depth: number): number => {
    const cached = blocks.get(node);
    if (cached) return cached.forward;
    const width = stretched.get(node)?.thickness ?? 1;
    const block: LightTimeBlock<T> = {
      event: timed[node.entry.index].event,
      top: node.entry.span.start,
      bottom: node.entry.span.end,
      near,
      far: Math.min(1, near + width * 2),
      depth,
      forward: 0,
    };
    blocks.set(node, block);
    for (const child of node.children)
      block.forward = Math.max(
        block.forward,
        visit(child, near + width, depth + 1) + 1
      );
    return block.forward;
  };
  roots.forEach((node) => visit(node, 0, 0));
  return [...blocks.values()];
}

export function lightDayBars(
  events: readonly LightCalendarEvent[],
  days: readonly Date[],
  includeTimed = false
) {
  const segments = events.flatMap((item) => {
    if (!includeTimed && !item.allDay) return [];
    const columns = days.flatMap((day, index) =>
      item.start < addDays(day, 1) &&
      (item.end > day || (+item.start === +item.end && item.start >= day))
        ? [index]
        : []
    );
    if (!columns.length) return [];
    return [{ item, start: columns[0], end: columns[columns.length - 1] + 1 }];
  });
  const hierarchy = new SegHierarchy();
  hierarchy.addSegs(
    segments.map((segment, index) => ({
      index,
      thickness: 1,
      span: { start: segment.start, end: segment.end },
    }))
  );
  return hierarchy.toRects().map((rect) => ({
    ...segments[rect.index],
    lane: rect.levelCoord,
  }));
}

/** Reserve the final available row for overflow and split spans only where needed. */
export function clipLightDayBars(
  bars: ReturnType<typeof lightDayBars>,
  dayCount: number,
  capacity: number
) {
  const visible: ReturnType<typeof lightDayBars> = [];
  const hidden: number[] = [];
  const previous = new Map<string, ReturnType<typeof lightDayBars>[number]>();
  for (let column = 0; column < dayCount; column++) {
    const covering = bars
      .filter((bar) => bar.start <= column && bar.end > column)
      .sort((a, b) => a.lane - b.lane);
    const overflowing = covering.length > capacity;
    const compact = overflowing || covering.some((bar) => bar.lane >= capacity);
    const limit = overflowing ? Math.max(0, capacity - 1) : covering.length;
    hidden.push(covering.length - limit);
    covering.slice(0, limit).forEach((bar, index) => {
      // Preserve continuous spans unless overflow or the row limit requires packing.
      const lane = compact ? index : bar.lane;
      const last = previous.get(bar.item.event.id);
      if (last?.lane === lane && last.end === column) {
        last.end = column + 1;
      } else {
        const segment = { ...bar, start: column, end: column + 1, lane };
        visible.push(segment);
        previous.set(bar.item.event.id, segment);
      }
    });
  }
  return { bars: visible, hidden };
}

/** Month rows share their tallest event; reserve the native more-link row on overflow. */
export function lightMonthRows(
  bars: ReturnType<typeof lightDayBars>,
  dayCount: number,
  availableHeight: number
) {
  const heights: number[] = [];
  for (const bar of bars)
    heights[bar.lane] = Math.max(
      heights[bar.lane] ?? 0,
      bar.item.allDay ? 20 : 24
    );
  const offsets: number[] = [];
  let total = 0;
  for (const height of heights) {
    offsets.push(total);
    total += height + 1;
  }
  let count = heights.length;
  if (total > availableHeight) {
    count = 0;
    while (
      count < heights.length &&
      offsets[count] + heights[count] + 1 <= availableHeight - 17
    )
      count++;
  }
  const hidden = Array.from(
    { length: dayCount },
    (_, column) =>
      bars.filter(
        (bar) => bar.lane >= count && bar.start <= column && bar.end > column
      ).length
  );
  return {
    bars: bars.filter((bar) => bar.lane < count),
    hidden,
    offsets,
    overflowTop: offsets[count] ?? total,
  };
}
