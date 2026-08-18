import { CalendarViewContextProvider } from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { isCalendarRangeSupported } from '@app/features/calendar/utils/calendar-supported-range';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { usePosthog } from '@app/lib/analytics/posthog';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { useUserId } from '@core/context/user';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { useCalendarOccurrencesQuery } from '@queries/calendar/occurrences';
import { createMemo, createSignal, onMount, Show } from 'solid-js';
import { CalendarFocusContextProvider } from './calendar-focus-target';
import { isCalendarBlockRange } from './calendar-range';
import { resolveCalendarBlockTarget } from './calendar-target';
import { Workspace } from './components/Workspace';
import type { CalendarBlockProps, CalendarBlockTargetRequest } from './types';

function targetRequestFromParams(
  params: CalendarBlockProps,
  requestId: number
): CalendarBlockTargetRequest | undefined {
  if (
    typeof params.eventId !== 'string' ||
    params.eventId.length === 0 ||
    !isCalendarBlockRange(params.range)
  ) {
    return undefined;
  }

  return {
    eventId: params.eventId,
    range: params.range,
    occurrenceKey:
      typeof params.occurrenceKey === 'string'
        ? params.occurrenceKey
        : undefined,
    requestId,
    requestedAt: Date.now(),
  };
}

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
  let nextRequestId = 1;
  const [targetRequest, setTargetRequest] = createSignal<
    CalendarBlockTargetRequest | undefined
  >(targetRequestFromParams(props, nextRequestId++));

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: Record<string, unknown>) => {
      const request = targetRequestFromParams(
        params as CalendarBlockProps,
        nextRequestId++
      );
      setTargetRequest(request);
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
  const focusTarget = createMemo(() => {
    const request = targetRequest();
    if (!request || occurrencesQuery.isPlaceholderData) return undefined;
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
