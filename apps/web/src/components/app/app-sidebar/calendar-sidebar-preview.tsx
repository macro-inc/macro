import { CalendarGridSkeleton } from '@app/features/calendar/components/CalendarGridSkeleton';
import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { useCalendarSources } from '@app/features/calendar/hooks/use-calendar-sources';
import { getDefaultCalendarTimeFormat } from '@app/features/calendar/utils/time-format';
import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { HoverCard } from '@ui/components/HoverCard';
import { createSignal, lazy, type ParentProps, Show, Suspense } from 'solid-js';

const CalendarEmbed = lazy(() =>
  import('@app/features/calendar/components/CalendarEmbed').then((module) => ({
    default: module.CalendarEmbed,
  }))
);

function dayRange(date: Date): CalendarOccurrenceQueryRange {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return createCalendarOccurrenceQueryRange(start, end);
}

function PreviewSkeleton() {
  return <CalendarGridSkeleton showDayHeader={false} showAllDaySlot={false} />;
}

function PreviewContent() {
  const initialDate = new Date();
  const [range, setRange] = createSignal<CalendarOccurrenceQueryRange>(
    dayRange(initialDate)
  );
  const { sourceById } = useCalendarSources();
  const data = useCalendarOccurrenceData({ range, sourceById });

  return (
    <div class="calendar-sidebar-preview relative size-full min-h-0 bg-surface">
      <CalendarEmbed
        initialDate={initialDate}
        events={data.visibleEvents()}
        eventsById={data.eventsById()}
        settings={{
          initialView: 'timeGridDay',
          dayCount: 1,
          showDayHeaders: false,
          collapseEmptyAllDaySlot: true,
          showWeekends: true,
          weekStartsOn: 0,
          timeFormat: getDefaultCalendarTimeFormat(),
        }}
        selection={{ color: 'var(--color-accent)' }}
        onDatesSet={({ start, end }) => {
          const nextRange = createCalendarOccurrenceQueryRange(start, end);
          const previousRange = range();
          if (
            previousRange.start !== nextRange.start ||
            previousRange.end !== nextRange.end ||
            previousRange.startDate !== nextRange.startDate ||
            previousRange.endDate !== nextRange.endDate
          ) {
            setRange(nextRange);
          }
        }}
      />

      <Show when={data.isLoading()}>
        <div class="absolute inset-0 bg-surface">
          <PreviewSkeleton />
        </div>
      </Show>
      <Show when={data.occurrencesQuery.isError}>
        <div class="absolute inset-x-3 bottom-3 rounded-lg border border-edge-muted bg-surface p-2 text-center text-xs text-ink-muted shadow-menu">
          Calendar events couldn’t be loaded.
        </div>
      </Show>
    </div>
  );
}

/** Calendar preview shown while hovering the Calendar sidebar row. */
export function CalendarSidebarPreview(
  props: ParentProps<{ disabled?: boolean }>
) {
  const [open, setOpen] = createSignal(false);

  return (
    <HoverCard
      as="div"
      triggerClass="w-full"
      content={
        <Show when={open() && !props.disabled}>
          <Suspense fallback={<PreviewSkeleton />}>
            <PreviewContent />
          </Suspense>
        </Show>
      }
      contentClass="h-[min(24rem,calc(100vh-2rem))] w-[min(20rem,calc(100vw-2rem))] items-stretch justify-stretch overflow-hidden rounded-xl bg-surface p-0 text-ink shadow-menu menu-open-animation"
      disabled={props.disabled}
      onOpenChange={setOpen}
      placement="right-start"
    >
      {props.children}
    </HoverCard>
  );
}
