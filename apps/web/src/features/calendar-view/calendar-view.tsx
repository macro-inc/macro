import { CalendarViewContextProvider } from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import type { CalendarPeriodView } from '@app/features/calendar/types';
import { isCalendarRangeSupported } from '@app/features/calendar/utils/calendar-supported-range';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { usePosthog } from '@app/lib/analytics/posthog';
import {
  createSearchParams,
  useNavigate,
  useParams,
} from '@app/lib/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { useUserId } from '@core/context/user';
import { useCalendarOccurrencesQuery } from '@queries/calendar/occurrences';
import { createEffect, createMemo, on, onMount, Show } from 'solid-js';
import { CalendarFocusContextProvider } from './calendar-focus-target';
import { resolveCalendarTarget } from './calendar-target';
import { createCalendarTargetAim } from './calendar-target-request';
import { calendarPath, calendarSearch } from './calendar-url';
import { Workspace } from './components/Workspace';
import { CALENDAR_VIEW_ID, type CalendarViewTarget } from './types';

function CalendarDisabledRedirect() {
  const panel = useSplitPanelOrThrow();
  onMount(() => {
    panel.handle.replace({ next: { type: 'component', id: 'inbox' } });
  });
  return null;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Route-backed Calendar application view. */
export function CalendarView() {
  const calendarUiEnabled = useCalendarUiFlag();
  const posthog = usePosthog();
  const userId = useUserId();
  const analytics = useAnalytics();
  const panel = useSplitPanelOrThrow();
  const navigate = useNavigate();
  const routeParams = useParams<{ period: CalendarPeriodView }>();
  const [search, setSearch] = createSearchParams(calendarSearch);
  const routeEventId = () => nonEmpty(search.eventId);
  const contentTarget = createMemo<CalendarViewTarget>(() => {
    const content = panel.handle.content();
    if (content.type !== 'component' || content.id !== CALENDAR_VIEW_ID) {
      return {};
    }
    return (content.params ?? {}) as CalendarViewTarget;
  });
  const initialContentTarget = contentTarget();
  const initialAim: CalendarViewTarget = nonEmpty(initialContentTarget.eventId)
    ? initialContentTarget
    : { eventId: routeEventId() };
  const aim = createCalendarTargetAim({ initial: initialAim });
  const targetRequest = aim.target;
  let initializedTargetSync = false;
  let locallyWrittenEventId: string | null = null;

  createEffect(
    on(
      [routeEventId, () => contentTarget().focusRequestId],
      ([eventId, focusRequestId], previous) => {
        if (!initializedTargetSync) {
          initializedTargetSync = true;
          return;
        }
        const previousFocusRequestId = previous?.[1];
        if (
          focusRequestId !== undefined &&
          focusRequestId !== previousFocusRequestId
        ) {
          aim.aimAt(contentTarget());
          return;
        }
        if (eventId === previous?.[0]) return;
        if (locallyWrittenEventId === (eventId ?? '')) {
          locallyWrittenEventId = null;
          return;
        }
        aim.aimAt(eventId ? { eventId } : {});
      }
    )
  );

  const occurrencesQuery = useCalendarOccurrencesQuery(
    () => ({ userId: userId(), range: targetRequest()?.range }),
    () => {
      const request = targetRequest();
      return {
        enabled:
          request !== undefined && isCalendarRangeSupported(request.range),
        refetchOnWindowFocus: false,
      };
    }
  );
  const focusTarget = createMemo(() => {
    const request = targetRequest();
    if (
      !request ||
      occurrencesQuery.isLoading ||
      occurrencesQuery.isPlaceholderData
    ) {
      return undefined;
    }
    return resolveCalendarTarget(occurrencesQuery.data?.items ?? [], request);
  });

  const setFocusedEventId = (eventId: string | undefined) => {
    const next = eventId ?? '';
    if (search.eventId === next) return;
    locallyWrittenEventId = next;
    setSearch({ eventId: next }, { history: 'replace' });
  };
  const setPeriodView = (period: CalendarPeriodView) => {
    if (routeParams.period === period) return;
    navigate(calendarPath(period));
  };

  onMount(() => {
    analytics.pageView('calendar');
    analytics.track('open_view', { viewId: 'calendar' });
  });

  return (
    <Show
      when={calendarUiEnabled()}
      fallback={
        <Show when={posthog.flagsLoaded()} fallback={<LoadingBlock />}>
          <CalendarDisabledRedirect />
        </Show>
      }
    >
      <CalendarFocusContextProvider target={focusTarget}>
        <CalendarViewContextProvider
          periodView={routeParams.period}
          focusedEventId={routeEventId()}
          onPeriodViewChange={setPeriodView}
          onFocusedEventIdChange={setFocusedEventId}
        >
          <Workspace />
        </CalendarViewContextProvider>
      </CalendarFocusContextProvider>
    </Show>
  );
}
