import { literal, NIL_UUID } from '@app/features/soup';
import { fireAndForget } from '@core/util/fireAndForget';
import { isTaskEntity } from '@entity';
import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createEffect, createMemo } from 'solid-js';
import { useCalendarView } from '../components/CalendarViewContext';
import type { CalendarEvent } from '../types';
import {
  isTaskDueInRange,
  taskDueCalendarEvent,
} from '../utils/task-due-events';

/** Recently updated tasks read per page. Soup caps a page at 500. */
const TASK_PAGE_LIMIT = 100;
/**
 * Stop after this many tasks. Due dates are not a server filter, so a due
 * date on a task updated less recently than these can be missing.
 */
const MAX_TASKS = 500;

const emptyTarget = (field: string, value: string = NIL_UUID) =>
  literal(field, value);

const DUE_TASK_QUERY: SoupAstItemsQueryArgs = {
  params: {
    expand: true,
    limit: TASK_PAGE_LIMIT,
    sort_method: 'updated_at',
    sort_direction: 'desc',
  },
  body: {
    calf: emptyTarget('id'),
    callf: emptyTarget('CallId'),
    ccf: emptyTarget('id'),
    cf: emptyTarget('cid'),
    chanf: emptyTarget('ChannelId'),
    cthf: emptyTarget('ThreadId'),
    ef: emptyTarget('ThreadId'),
    fef: emptyTarget('id'),
    pf: emptyTarget('pid'),
    df: literal('dst', 'task'),
  },
};

export function useCalendarDueTasks(options: {
  range: Accessor<CalendarOccurrenceQueryRange | undefined>;
  /** Deferred visibility, so the checkbox paints before the grid redraws. */
  shown: Accessor<boolean>;
}): { events: Accessor<CalendarEvent[]> } {
  const calendarView = useCalendarView();
  const query = useSoupAstItemsQuery(
    () => DUE_TASK_QUERY,
    () => ({ enabled: calendarView.showDueTasks })
  );

  createEffect(() => {
    if (!calendarView.showDueTasks) return;
    if (
      query.isPending ||
      query.isFetchingNextPage ||
      query.isFetchNextPageError ||
      !query.hasNextPage
    ) {
      return;
    }
    const loaded = query.data?.entities.length ?? 0;
    if (loaded === 0 || loaded >= MAX_TASKS) return;
    fireAndForget(query.fetchNextPage(), 'calendar-due-tasks');
  });

  const events = createMemo(() => {
    if (!options.shown()) return [];
    const range = options.range();
    if (!range) return [];
    const tasks = query.data?.entities ?? [];
    const chips: CalendarEvent[] = [];
    for (const entity of tasks) {
      if (!isTaskEntity(entity)) continue;
      const event = taskDueCalendarEvent(entity);
      if (!event || !isTaskDueInRange(event.start, range)) continue;
      chips.push(event);
    }
    chips.sort((left, right) =>
      left.start < right.start
        ? -1
        : left.start > right.start
          ? 1
          : left.title.localeCompare(right.title)
    );
    return chips;
  });

  return { events };
}
