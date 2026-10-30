import { useCalendarAddSharedEventFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { downloadCalendarEventIcs } from '@app/features/calendar-view/download-event-ics';
import { useHoldParentHoverCardOpen } from '@core/component/HoverCard';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import CheckIcon from '@icon/system/regular/check.svg';
import DownloadSimpleIcon from '@icon/system/regular/download-simple.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import XIcon from '@icon/system/regular/x.svg';
import { useCopySharedCalendarEventMutation } from '@queries/calendar/copy';
import {
  isJoinRequestDeclined,
  isSharerCannotInvite,
  useRequestToJoinCalendarEventMutation,
} from '@queries/calendar/join-requests';
import type { CalendarJoinRequestStatus } from '@service-storage/generated/schemas/calendarJoinRequestStatus';
import { Button } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import {
  AddToCalendarButton,
  toastAddToCalendarFailure,
} from './AddToCalendarButton';

/**
 * Actions for a meeting the viewer sees only because it was shared with one
 * of their channels: ask the person who shared it to add them as a guest,
 * add a snapshot of it to one of their Google calendars, or download it for a
 * calendar Macro does not write to.
 */
export function SharedEventActions(props: {
  /** The channel-shared event the mention names. */
  eventId: string;
  title: string;
  /** Whether the person who shared the event can add the viewer as a guest. */
  canRequestToJoin: boolean;
  /** The viewer's request to join, if they made one. */
  joinRequestStatus?: CalendarJoinRequestStatus;
}) {
  const addSharedEvent = useCalendarAddSharedEventFlag();
  const [menuOpen, setMenuOpen] = createSignal(false);
  // The calendar menu portals out of the hover card; keep the card open
  // while the viewer picks a calendar.
  useHoldParentHoverCardOpen(menuOpen);

  const copy = useCopySharedCalendarEventMutation({
    onSuccess: () => toast.success('Added to your calendar'),
    onError: toastAddToCalendarFailure,
  });

  // Shown as sent from the moment the ask succeeds, ahead of the preview
  // refetch that carries the stored status: it holds only while the status is
  // still the one the ask was sent from, so a later answer replaces it.
  const [askedFrom, setAskedFrom] = createSignal<{
    status: CalendarJoinRequestStatus | undefined;
  }>();
  const asked = () => {
    const sent = askedFrom();
    return sent !== undefined && sent.status === props.joinRequestStatus;
  };
  // The sharer's answer is an invitation to the meeting itself. A snapshot
  // added meanwhile would take that invitation in under its own UID and stay
  // a snapshot, so adding one waits until the request is declined.
  const requestOutstanding = () =>
    props.joinRequestStatus === 'pending' ||
    props.joinRequestStatus === 'accepted' ||
    asked();
  const requestToJoin = useRequestToJoinCalendarEventMutation({
    onSuccess: () => {
      setAskedFrom({ status: props.joinRequestStatus });
      toast.success('Asked to be added as a guest');
    },
    onError: (error) =>
      toast.failure(
        isSharerCannotInvite(error)
          ? "The person who shared this event can't add guests to it"
          : isJoinRequestDeclined(error)
            ? 'The person who shared this event declined your request'
            : 'Failed to ask to join the event'
      ),
  });
  // A declined request stands: the card says so instead of offering to ask
  // again, and the sharer is never asked twice.
  const declined = () => props.joinRequestStatus === 'declined';

  return (
    <div
      class="mt-1 flex flex-wrap items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <Switch>
        <Match when={props.joinRequestStatus === 'pending' || asked()}>
          <span class="flex h-5 items-center gap-1 px-1 text-xs text-ink-muted">
            <CheckIcon class="size-3" />
            Requested
          </span>
        </Match>
        <Match when={props.joinRequestStatus === 'accepted'}>
          <span class="flex h-5 items-center gap-1 px-1 text-xs text-ink-muted">
            <CheckIcon class="size-3" />
            Invited
          </span>
        </Match>
        <Match when={declined()}>
          <span class="flex h-5 items-center gap-1 px-1 text-xs text-ink-muted">
            <XIcon class="size-3" />
            Declined
          </span>
        </Match>
        <Match when={props.canRequestToJoin}>
          <Button
            variant="secondary"
            size="xs"
            disabled={requestToJoin.isPending}
            onClick={() => requestToJoin.mutate(props.eventId)}
          >
            <UserPlusIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
            Ask to join
          </Button>
        </Match>
      </Switch>
      <Show when={addSharedEvent() && !requestOutstanding()}>
        <AddToCalendarButton
          size="xs"
          pending={copy.isPending}
          onAdd={(calendarId) =>
            copy.mutate({ eventId: props.eventId, calendarId })
          }
          onMenuOpenChange={setMenuOpen}
        />
      </Show>
      <Button
        variant="ghost"
        size="xs"
        onClick={() =>
          fireAndForget(
            downloadCalendarEventIcs({
              eventId: props.eventId,
              title: props.title,
            }),
            'shared-event-actions'
          )
        }
      >
        <DownloadSimpleIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
        Download .ics
      </Button>
      <Switch>
        <Match when={declined()}>
          <p class="w-full text-xs text-ink-muted">
            The person who shared this event declined your request to join.
          </p>
        </Match>
        <Match when={!props.canRequestToJoin && !requestOutstanding()}>
          <p class="w-full text-xs text-ink-muted">
            The person who shared this event can't add guests to it.
          </p>
        </Match>
      </Switch>
    </div>
  );
}
