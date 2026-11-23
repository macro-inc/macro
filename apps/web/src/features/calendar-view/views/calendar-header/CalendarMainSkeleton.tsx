import { useViewShell, ViewShell } from '@app/components/view-shell';
import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { CALENDAR_PERIODS } from '@app/features/calendar/core/periods';
import type { CalendarPeriodView } from '@app/features/calendar/types';
import { calendarPeriodLabel } from '@app/features/calendar/utils/calendar-label';
import { For, type ParentProps, Show } from 'solid-js';

/** Match the desktop header while retaining the touch host's existing chrome. */
export function CalendarMainSkeleton(
  props: ParentProps<{ title: string; period: CalendarPeriodView }>
) {
  const shell = useViewShell();
  // The toolbar's 20px inline inset offsets the pane's 760px/304px breakpoints.
  return (
    <ViewSkeleton.Main>
      <ViewShell.TopBar class="@container/calendar-toolbar h-auto min-h-12 flex-wrap items-start gap-x-2 not-touch:gap-y-4 py-2">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <ViewSkeleton.Control control={2} />
          <ViewSkeleton.Control
            control="Today"
            class="hidden @min-[284px]/calendar-toolbar:inline-flex"
          />
          <ViewSkeleton.Control
            control={1}
            class="@min-[284px]/calendar-toolbar:hidden"
          />
          <div class="flex-1" />
          <div class="hidden items-center gap-1 @min-[740px]/calendar-toolbar:flex">
            <For each={CALENDAR_PERIODS}>
              {(view) => (
                <ViewSkeleton.Control control={calendarPeriodLabel(view)} />
              )}
            </For>
          </div>
          <ViewSkeleton.Control
            control={calendarPeriodLabel(props.period)}
            class="max-w-18 @min-[740px]/calendar-toolbar:hidden"
          />
          <ViewSkeleton.Control
            control={1}
            class="@min-[740px]/calendar-toolbar:w-52"
          />
        </div>
        <div class="flex min-h-9 min-w-0 basis-full items-center gap-2">
          <h1 class="min-w-0 flex-1 truncate pl-1 text-xl font-semibold">
            {props.title}
          </h1>
          <Show when={!shell.breakpoints.narrow?.()}>
            <ViewSkeleton.Control control="Booking links ⌄" />
          </Show>
          <ViewSkeleton.Control control="+ New ⌄" />
        </div>
      </ViewShell.TopBar>
      {props.children}
    </ViewSkeleton.Main>
  );
}
