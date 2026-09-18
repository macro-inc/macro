import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { getMeetingUrl } from '@channel/Call/call-link';
import { throwOnErr } from '@core/util/result';
import { useActiveCallsQuery } from '@queries/call/call';
import { callKeys } from '@queries/call/keys';
import { useMeetingsQuery } from '@queries/call/meetings';
import { useSoupItemsQuery } from '@queries/soup/items';
import { callServiceClient } from '@service-call/client';
import { useQueries } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { CalendarCallsSource } from '../context/calendar-calls';
import {
  buildCalendarCallItems,
  type CalendarCallEvent,
  type CalendarCallRecord,
} from '../core/calendar-calls';

export function useCalendarCallsSource(
  events: Accessor<CalendarCallEvent[]>
): CalendarCallsSource {
  const meetings = useMeetingsQuery({ refetchInterval: 15_000 });
  const active = useActiveCallsQuery();
  const liveIds = () => [
    ...new Set([
      ...(active.isSuccess ? active.data.map((call) => call.callId) : []),
      ...(meetings.isSuccess
        ? meetings.data.flatMap((meeting) =>
            meeting.callId ? [meeting.callId] : []
          )
        : []),
    ]),
  ];
  // Reuse the call-record cache for actual live participants, not channel membership.
  const liveDetails = useQueries(() => ({
    queries: liveIds().map((callId) => ({
      queryKey: callKeys.record(callId).queryKey,
      queryFn: () => throwOnErr(() => callServiceClient.getCallRecord(callId)),
      staleTime: 15_000,
      refetchInterval: 15_000,
      retry: false,
    })),
  }));
  const history = useSoupItemsQuery(() => ({
    params: { sort_method: 'created_at', sort_direction: 'desc', limit: 50 },
    body: { ...QUERY_FILTERS_BASE, call_filters: undefined },
  }));
  const historyRecords = (): CalendarCallRecord[] =>
    history.isSuccess
      ? history.data.flatMap((entity) =>
          entity.type === 'call'
            ? [
                {
                  id: entity.id,
                  title: entity.name,
                  startedAt:
                    entity.createdAt instanceof Date
                      ? entity.createdAt.toISOString()
                      : (entity.createdAt ?? ''),
                  active: entity.isActive,
                  channelId: entity.channelId ?? undefined,
                  durationMs: entity.durationMs,
                  status: entity.status,
                  people: entity.participantIds.map(
                    (id) =>
                      entity.participantNames?.[id] ??
                      (id.startsWith('macro|') ? id.slice(6) : 'Guest')
                  ),
                  participants: entity.participantIds.map((id) => ({
                    id,
                    name: entity.participantNames?.[id],
                    email: id.startsWith('macro|') ? id.slice(6) : '',
                  })),
                  summary: entity.summary,
                },
              ]
            : []
        )
      : [];
  const records = () => {
    const activeById = new Map(
      active.isSuccess ? active.data.map((call) => [call.callId, call]) : []
    );
    const past = historyRecords().map((record) => {
      const live = activeById.get(record.id);
      return live
        ? { ...record, active: true, participantCount: live.participantCount }
        : record;
    });
    const ids = new Set(past.map((record) => record.id));
    const live: CalendarCallRecord[] = active.isSuccess
      ? active.data
          .filter((call) => !ids.has(call.callId))
          .map((call) => ({
            id: call.callId,
            title: 'Channel call',
            channelId: call.channelId,
            startedAt: call.createdAt,
            active: true,
            people: [],
            participantCount: call.participantCount,
          }))
      : [];
    const records = [...live, ...past];
    for (const query of liveDetails) {
      if (!query.isSuccess) continue;
      const call = query.data;
      const participants = call.participants
        .filter((person) => !call.isActive || !person.leftAt)
        .map((person) => ({
          id: person.userId,
          name:
            person.displayName ??
            (person.userId.startsWith('macro|') ? undefined : 'Guest'),
          email: person.userId.startsWith('macro|')
            ? person.userId.slice(6)
            : '',
        }));
      const index = records.findIndex((record) => record.id === call.callId);
      const record: CalendarCallRecord = {
        ...(index >= 0 ? records[index] : {}),
        id: call.callId,
        title: call.customName ?? call.channelName ?? 'Call',
        startedAt: call.startedAt,
        channelId: call.channelId ?? undefined,
        channelName: call.channelName ?? undefined,
        active: call.isActive,
        participants,
        participantCount: participants.length,
        people: participants.map((person) => person.name ?? person.email),
      };
      if (index >= 0) records[index] = record;
      else records.push(record);
    }
    return records;
  };
  return {
    items: () =>
      buildCalendarCallItems(
        meetings.isSuccess
          ? meetings.data.map((meeting) => ({
              id: meeting.id,
              title: meeting.title,
              url: getMeetingUrl(meeting.shareToken),
              start: meeting.scheduledStart ?? undefined,
              end: meeting.scheduledEnd ?? undefined,
              callId: meeting.callId ?? undefined,
              channelId: meeting.channelId ?? undefined,
            }))
          : [],
        events(),
        records()
      ),
    loading: () =>
      meetings.isPending &&
      history.isPending &&
      events().length === 0 &&
      (!active.isSuccess || active.data.length === 0),
    error: () =>
      meetings.isError && history.isError
        ? 'Could not load calls. Please try again.'
        : meetings.isError
          ? 'Your call links could not be loaded.'
          : history.isError
            ? 'Recent calls could not be loaded.'
            : active.isError
              ? 'Live channel calls could not be loaded.'
              : undefined,
    refreshing: () =>
      meetings.isFetching || history.isFetching || active.isFetching,
    hasMore: () => history.hasNextPage,
    loadMore: () => {
      void history.fetchNextPage();
    },
    refresh: () => {
      void meetings.refetch();
      void history.refetch();
      void active.refetch();
    },
  };
}
