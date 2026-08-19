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
import { fetchCalendarMentionPreview } from '@queries/calendar/mention-preview';
import { useCalendarOccurrencesQuery } from '@queries/calendar/occurrences';
import { useSearchParams } from '@solidjs/router';
import { createMemo, createSignal, onMount, Show } from 'solid-js';
import { CalendarFocusContextProvider } from './calendar-focus-target';
import {
  type CalendarBlockEventTime,
  createCalendarBlockRange,
  isCalendarBlockRange,
} from './calendar-range';
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

/**
 * A target with an event id but no usable range — a copied `/app/calendar`
 * link or a mention without preview data — resolves through the calendar
 * mention preview API, which also maps another user's projection of the
 * meeting to the viewer's own copy.
 */
async function resolveTargetRequestFromPreview(
  params: CalendarBlockProps,
  requestId: number
): Promise<CalendarBlockTargetRequest | undefined> {
  if (typeof params.eventId !== 'string' || params.eventId.length === 0) {
    return undefined;
  }
  const occurrenceKey =
    typeof params.occurrenceKey === 'string' ? params.occurrenceKey : undefined;
  const event = await fetchCalendarMentionPreview(
    params.eventId,
    occurrenceKey
  ).catch(() => null);
  if (!event) return undefined;

  const time: CalendarBlockEventTime =
    event.time.kind === 'timed'
      ? {
          kind: 'timed',
          startsAt: event.time.startsAt,
          endsAt: event.time.endsAt,
        }
      : {
          kind: 'allDay',
          startDate: event.time.startDate,
          endDate: event.time.endDate,
        };
  const range = createCalendarBlockRange(time);
  if (!range) return undefined;

  return {
    eventId: event.viewerEventId,
    range,
    occurrenceKey: event.occurrenceKey ?? occurrenceKey,
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
  let nextRequestId = 1;
  let latestRequestId = 0;
  const [targetRequest, setTargetRequest] = createSignal<
    CalendarBlockTargetRequest | undefined
  >(targetRequestFromParams(initialAim, nextRequestId++));

  // Preview resolution is async, so a stale answer must never clobber a
  // target the user has since re-aimed or cleared.
  const applyResolvedTarget = (request: CalendarBlockTargetRequest) => {
    if (request.requestId < latestRequestId) return;
    setTargetRequest(request);
  };

  const aimAtParams = (params: CalendarBlockProps) => {
    const requestId = nextRequestId++;
    latestRequestId = requestId;
    const direct = targetRequestFromParams(params, requestId);
    if (direct) {
      setTargetRequest(direct);
      return;
    }
    if (typeof params.eventId === 'string' && params.eventId.length > 0) {
      resolveTargetRequestFromPreview(params, requestId).then((resolved) => {
        if (resolved) applyResolvedTarget(resolved);
      });
      return;
    }
    setTargetRequest(undefined);
  };

  if (
    !targetRequest() &&
    typeof initialAim.eventId === 'string' &&
    initialAim.eventId
  ) {
    aimAtParams(initialAim);
  }

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: Record<string, unknown>) => {
      aimAtParams(params as CalendarBlockProps);
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
