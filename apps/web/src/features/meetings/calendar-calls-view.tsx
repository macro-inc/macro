import { globalSplitManager } from '@app/signal/splitLayout';
import { getMeetingPath, getMeetingUrl } from '@channel/Call/call-link';
import { UserIcon } from '@core/component/UserIcon';
import { useChannelsContext } from '@core/context/channels';
import { useContacts } from '@core/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { openExternalUrl } from '@core/util/url';
import { getWebOrigin } from '@core/util/webOrigin';
import { useActiveCallsQuery } from '@queries/call/call';
import {
  fetchCallLink,
  useCancelMeetingMutation,
  useInviteToMeetingMutation,
  useMeetingsQuery,
  useUpdateMeetingMutation,
} from '@queries/call/meetings';
import { useNavigate } from '@solidjs/router';
import { createMemo, createSignal, Show } from 'solid-js';
import { CalendarQuickCall } from './calendar-quick-call';
import { CalendarActiveCallNotice } from './components/calendar-active-call-notice';
import { CalendarPersonAvatar } from './components/calendar-person-avatar';
import {
  type CalendarCallEvent,
  type CalendarCallItem,
  calendarCallNavigation,
  calendarCallUrl,
} from './core/calendar-calls';
import { useCalendarCallsSource } from './queries/calendar-calls';
import { CalendarCalls } from './views/calendar-calls';
import { CallInvite } from './views/call-invite';

export type { CalendarCallEvent } from './core/calendar-calls';

export function CalendarCallsView(props: {
  onScheduleCall: () => void;
  events?: CalendarCallEvent[];
  onOpenEvent?: (eventId: string, occurrenceKey?: string) => void;
  onEditEvent?: (eventId: string, occurrenceKey?: string) => void;
  onInviteToEvent?: (event: CalendarCallEvent, email: string) => Promise<void>;
}) {
  const source = useCalendarCallsSource(() => props.events ?? []);
  const channels = useChannelsContext();
  const contacts = useContacts();
  const contactPhotos = createMemo(
    () =>
      new Map(
        contacts().map((person) => [
          person.email.toLowerCase(),
          person.photoUrl,
        ])
      )
  );
  const items = () =>
    source.items().map((item) => {
      const channelId = item.record?.channelId;
      const channelName = channelId
        ? (channels.channelsById()[channelId]?.name ?? undefined)
        : undefined;
      return channelName && item.record
        ? {
            ...item,
            title: item.title === 'Channel call' ? channelName : item.title,
            record: { ...item.record, channelName },
          }
        : item;
    });
  const navigate = useNavigate();
  const update = useUpdateMeetingMutation();
  const cancel = useCancelMeetingMutation();
  const invite = useInviteToMeetingMutation();
  const openRecord = (id: string) => {
    globalSplitManager()?.openWithSplit(
      { type: 'call', id },
      { activate: true }
    );
  };
  async function join(item: CalendarCallItem) {
    let url = calendarCallUrl(item);
    if (!url && item.record?.active) {
      const meeting = await fetchCallLink(item.record.id);
      url = getMeetingPath(meeting.shareToken);
    }
    if (!url) return;
    const target = calendarCallNavigation(url, getWebOrigin());
    if (target.kind === 'external') openExternalUrl(target.url);
    else {
      const destination = new URL(target.path, getWebOrigin());
      if (item.group === 'instant')
        destination.searchParams.set('join', 'true');
      navigate(
        `${destination.pathname}${destination.search}${destination.hash}`
      );
    }
  }
  return (
    <CalendarCalls
      source={{ ...source, items }}
      renderInvite={(item) => {
        if (item.event)
          return item.event.canInvite && props.onInviteToEvent ? (
            <CallInvite
              onInvite={(email) => props.onInviteToEvent!(item.event!, email)}
            />
          ) : undefined;
        if (!item.link) return undefined;
        const token = new URL(item.link.url).pathname
          .split('/')
          .filter(Boolean)
          .at(-1)!;
        return (
          <CallInvite
            onInvite={async (email) => {
              await invite.mutateAsync({ shareToken: token, email });
            }}
          />
        );
      }}
      renderAvatar={(person) =>
        person.id?.startsWith('macro|') || person.email ? (
          <UserIcon
            id={person.id ?? `macro|${person.email}`}
            size="sm"
            suppressClick
            showTooltip={false}
            photoUrl={
              person.photoUrl ?? contactPhotos().get(person.email.toLowerCase())
            }
          />
        ) : (
          <CalendarPersonAvatar person={person} />
        )
      }
      startCall={<CalendarQuickCall />}
      actions={{
        schedule: props.onScheduleCall,
        join,
        copy: (url) => writeClipboardData({ 'text/plain': url }),
        resolveLink: async (item) =>
          item.record?.active
            ? getMeetingUrl((await fetchCallLink(item.record.id)).shareToken)
            : undefined,
        openRecord,
        openEvent: props.onOpenEvent
          ? (event) => props.onOpenEvent!(event.eventId, event.occurrenceKey)
          : undefined,
        editEvent: props.onEditEvent
          ? (event) => props.onEditEvent!(event.eventId, event.occurrenceKey)
          : undefined,
        rename: async (id, title) => {
          await update.mutateAsync({ meetingId: id, title });
        },
        revoke: async (id) => {
          await cancel.mutateAsync(id);
        },
      }}
    />
  );
}

/** Quick Calls remain in the call list instead of becoming calendar events. */
export function CalendarActiveCallSidebar(props: { onShowCalls: () => void }) {
  const meetings = useMeetingsQuery({ refetchInterval: 15_000 });
  const active = useActiveCallsQuery();
  const navigate = useNavigate();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(false);
  const live = () => {
    const meeting = meetings.isSuccess
      ? meetings.data.find((candidate) => candidate.callId)
      : undefined;
    if (meeting)
      return {
        title: meeting.title,
        description: meeting.scheduledStart
          ? 'Scheduled call in progress'
          : 'Quick Call · not on the calendar',
        callId: meeting.callId!,
        shareToken: meeting.shareToken,
      };
    const channel = active.isSuccess ? active.data[0] : undefined;
    return channel
      ? {
          title: 'Channel call',
          description: `${channel.participantCount} in the call`,
          callId: channel.callId,
        }
      : undefined;
  };
  async function join() {
    const call = live();
    if (!call || pending()) return;
    setPending(true);
    setError(false);
    try {
      const token =
        call.shareToken ?? (await fetchCallLink(call.callId)).shareToken;
      navigate(getMeetingPath(token).replace(/^\/app/, ''));
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <Show when={live()}>
      {(call) => (
        <CalendarActiveCallNotice
          title={call().title}
          description={call().description}
          pending={pending()}
          error={error()}
          onShowCalls={props.onShowCalls}
          onJoin={() => void join()}
        />
      )}
    </Show>
  );
}
