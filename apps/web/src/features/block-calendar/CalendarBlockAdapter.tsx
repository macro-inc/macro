import { CalendarViewContextProvider } from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { isCalendarRangeSupported } from '@app/features/calendar/utils/calendar-supported-range';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { usePosthog } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { useUserId } from '@core/context/user';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { useCalendarOccurrencesQuery } from '@queries/calendar/occurrences';
import { useSearchParams } from '@solidjs/router';
import { createMemo, onMount, Show } from 'solid-js';
import { CalendarFocusContextProvider } from './calendar-focus-target';
import { resolveCalendarBlockTarget } from './calendar-target';
import { createCalendarTargetAim } from './calendar-target-request';
import { Workspace } from './components/Workspace';
import type { CalendarBlockProps } from './types';

function CalendarBlockDisabledRedirect() {
  const panel = useSplitPanelOrThrow();
  onMount(() => {
    panel.handle.replace({ next: { type: 'component', id: 'inbox' } });
  });
  return null;
}

/** Bridges the singleton block lifecycle and navigation API to CalendarView. */
function CalendarBlockAdapter(props: CalendarBlockProps) {
  const calendarUiEnabled = useCalendarUiFlag();
  const posthog = usePosthog();
  const userId = useUserId();
  const analytics = useAnalytics();
  const blockHandle = blockHandleSignal.get;
  const [searchParams] = useSearchParams();
  const searchParam = (value: string | string[] | undefined) =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  // In-app opens pass the target through split content props, but a deep
  // link carries it in the query string, which never reaches block props.
  // Query params are only trusted for a single-split URL, mirroring the
  // channel block's deep-link guard.
  const queryAim =
    globalSplitManager()?.splits().length === 1
      ? {
          eventId: searchParam(searchParams.eventId),
          occurrenceKey: searchParam(searchParams.occurrenceKey),
        }
      : {};
  const initialAim: CalendarBlockProps = {
    eventId:
      typeof props.eventId === 'string' && props.eventId.length > 0
        ? props.eventId
        : queryAim.eventId,
    occurrenceKey:
      typeof props.occurrenceKey === 'string' && props.occurrenceKey.length > 0
        ? props.occurrenceKey
        : queryAim.occurrenceKey,
    range: props.range,
  };
  const aim = createCalendarTargetAim({ initial: initialAim });
  const targetRequest = aim.target;

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: Record<string, unknown>) => {
      aim.aimAt(params as CalendarBlockProps);
    },
  });

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
  // A cold `.data` read suspends the nearest <Suspense>, which is the one
  // wrapping each calendar page: the first aim of a session enables this
  // query, so reading it unguarded blanks the whole grid for the length of
  // the fetch and remounts it. There is no target to resolve until the
  // occurrences land anyway.
  const focusTarget = createMemo(() => {
    const request = targetRequest();
    if (
      !request ||
      occurrencesQuery.isLoading ||
      occurrencesQuery.isPlaceholderData
    ) {
      return undefined;
    }
    return resolveCalendarBlockTarget(
      occurrencesQuery.data?.items ?? [],
      request
    );
  });

  onMount(() => {
    analytics.pageView('calendar');
    analytics.track('open_view', { viewId: 'calendar' });
  });

  return (
    <Show
      when={calendarUiEnabled()}
      fallback={
        <Show when={posthog.flagsLoaded()} fallback={<LoadingBlock />}>
          <CalendarBlockDisabledRedirect />
        </Show>
      }
    >
      <CalendarFocusContextProvider target={focusTarget}>
        <CalendarViewContextProvider>
          <Workspace />
        </CalendarViewContextProvider>
      </CalendarFocusContextProvider>
    </Show>
  );
}

export default CalendarBlockAdapter;
