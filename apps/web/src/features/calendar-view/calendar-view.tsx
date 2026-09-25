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
import deepEqual from 'fast-deep-equal';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { CalendarFocusContextProvider } from './calendar-focus-target';
import { resolveCalendarTarget } from './calendar-target';
import { createCalendarTargetAim } from './calendar-target-request';
import { calendarSearch, calendarSearchTarget } from './calendar-url';
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

export type CalendarViewProps = {
  /** The route this view is mounted under; period changes navigate within it. */
  route: { id: string };
  /** A new value re-aims at the URL's event without a navigation. */
  refocus?: Accessor<unknown>;
};

/** Route-backed Calendar view, hosted by its own route or inline under another. */
export function CalendarView(props: CalendarViewProps) {
  const calendarUiEnabled = useCalendarUiFlag();
  const posthog = usePosthog();
  const userId = useUserId();
  const analytics = useAnalytics();
  const panel = useSplitPanelOrThrow();
  const navigate = useNavigate();
  const routeParams = useParams<{ period: CalendarPeriodView }>();
  const [search, setSearch] = createSearchParams(calendarSearch);
  const routeTarget = createMemo(
    () => calendarSearchTarget(search),
    undefined,
    {
      equals: deepEqual,
    }
  );
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
    : routeTarget();
  const aim = createCalendarTargetAim({ initial: initialAim });
  const targetRequest = aim.target;
  let initializedTargetSync = false;
  let locallyWrittenEventId: string | null = null;
  // The event an aim is paging toward. Paging closes open details, and that
  // transient close, like the landing itself, must not rewrite the URL the aim
  // came from: its locator is what makes a repeat request the same destination.
  let aimingEventId = nonEmpty(initialAim.eventId);
  const aimAt = (target: CalendarViewTarget) => {
    aimingEventId = nonEmpty(target.eventId);
    aim.aimAt(target);
  };
  // A period change closes the selected event in the pager. Home keeps the
  // event in search, so re-aim after the new period is committed to reopen it.
  createEffect(
    on(
      () => routeParams.period,
      (period, previousPeriod) => {
        if (
          !panel.isInlinePreview ||
          previousPeriod === undefined ||
          period === previousPeriod
        ) {
          return;
        }
        let cancelled = false;
        // The pager closes its selection after it changes the route. Re-aim
        // after that synchronous close, not at the old chip before it closes.
        queueMicrotask(() => {
          if (cancelled || routeParams.period !== period) return;
          const target = routeTarget();
          if (target.eventId) aimAt(target);
        });
        onCleanup(() => {
          cancelled = true;
        });
      }
    )
  );
  createEffect(
    on(
      () => props.refocus?.(),
      () => {
        const target = routeTarget();
        if (target.eventId) aimAt(target);
      },
      { defer: true }
    )
  );
  createEffect(
    on(
      targetRequest,
      (request) => {
        // An aim that resolves to nothing will never land.
        if (!request) aimingEventId = undefined;
      },
      { defer: true }
    )
  );

  createEffect(
    on(
      [routeTarget, () => contentTarget().focusRequestId],
      ([target, focusRequestId], previous) => {
        if (!initializedTargetSync) {
          initializedTargetSync = true;
          return;
        }
        const previousFocusRequestId = previous?.[1];
        if (
          focusRequestId !== undefined &&
          focusRequestId !== previousFocusRequestId
        ) {
          aimAt(contentTarget());
          return;
        }
        if (target === previous?.[0]) return;
        if (locallyWrittenEventId === (target.eventId ?? '')) {
          locallyWrittenEventId = null;
          return;
        }
        aimAt(target.eventId ? target : {});
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
    if (aimingEventId !== undefined) {
      if (!next) return;
      const landed = next === aimingEventId;
      aimingEventId = undefined;
      if (landed) return;
    }
    // Inline, a dismissed popover is not a destination change: the host's
    // selection still names this event, and clearing it would make the next
    // request for the same event a navigation.
    if (!next && panel.isInlinePreview) return;
    if (search.eventId === next) return;
    locallyWrittenEventId = next;
    // A locally focused event is already on screen; drop the locator with it.
    setSearch({ eventId: next }, { mode: 'replace', history: 'replace' });
  };
  const setPeriodView = (period: CalendarPeriodView) => {
    if (routeParams.period === period) return;
    navigate({ route: props.route, params: { period } });
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
          focusedEventId={routeTarget().eventId}
          onPeriodViewChange={setPeriodView}
          onFocusedEventIdChange={setFocusedEventId}
        >
          <Workspace />
        </CalendarViewContextProvider>
      </CalendarFocusContextProvider>
    </Show>
  );
}
