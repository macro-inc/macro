import { useHoldParentHoverCardOpen } from '@core/component/HoverCard';
import { toast } from '@core/component/Toast/Toast';
import CalendarPlusIcon from '@phosphor/calendar-plus.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import DownloadIcon from '@phosphor/download-simple.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useRequestToJoinCalendarEventMutation } from '@queries/calendar/join-requests';
import {
  useCopySharedCalendarEventMutation,
  useDownloadCalendarEventIcsMutation,
} from '@queries/calendar/mutations';
import type { CalendarMentionEventJoinRequestStatus } from '@service-storage/generated/schemas/calendarMentionEventJoinRequestStatus';
import { Button, Dropdown } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';

/** File name for an exported event, derived from its title. */
export function icsFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'event'}.ics`;
}

/**
 * Actions for a meeting the viewer sees only because it was shared with one
 * of their channels: ask its owner to add them as a guest, add a private copy
 * to one of their calendars, or download it for a calendar Macro does not
 * write to.
 */
export function SharedEventActions(props: {
  eventId: string;
  title: string;
  /** Whether the event's owner can add the viewer as a guest. */
  canRequestToJoin: boolean;
  /** The viewer's request to join, if they made one. */
  joinRequestStatus?: CalendarMentionEventJoinRequestStatus;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  // The calendar menu portals out of the hover card; keep the card open
  // while the viewer picks a calendar.
  useHoldParentHoverCardOpen(menuOpen);

  const calendars = useVisibleCalendarsQuery();
  // Reading `data` while the query is pending would suspend the whole hover
  // card; until the list arrives there is simply nothing to pick.
  const writableCalendars = () =>
    (calendars.isSuccess ? calendars.data : []).filter(
      (calendar) => calendar.isWritable
    );

  const copy = useCopySharedCalendarEventMutation({
    onSuccess: () => toast.success('Added to your calendar'),
    onError: (error) =>
      toast.failure(
        error.message || 'Failed to add the event to your calendar'
      ),
  });
  const addToCalendar = (calendarId?: string) => {
    copy.mutate({ eventId: props.eventId, calendarId });
  };

  // Shown as sent from the moment the ask succeeds, ahead of the preview
  // refetch that carries the stored status.
  const [asked, setAsked] = createSignal(false);
  const requestToJoin = useRequestToJoinCalendarEventMutation({
    onSuccess: () => {
      setAsked(true);
      toast.success('Asked the organizer to add you');
    },
    onError: (error) =>
      toast.failure(error.message || 'Failed to ask to join the event'),
  });

  const download = useDownloadCalendarEventIcsMutation({
    onSuccess: (document) => {
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(document)], { type: 'text/calendar' })
      );
      // Safari ignores clicks on a detached link and starts the download a
      // turn later, so the link is attached and the URL outlives the click.
      const link = window.document.createElement('a');
      link.href = url;
      link.download = icsFileName(props.title);
      link.style.display = 'none';
      window.document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: () => toast.failure('Failed to download the event'),
  });

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
        <Match when={props.canRequestToJoin}>
          <Button
            variant="outline"
            size="xs"
            disabled={requestToJoin.isPending}
            onClick={() => requestToJoin.mutate(props.eventId)}
          >
            <UserPlusIcon />
            Ask to join
          </Button>
        </Match>
      </Switch>
      <Show
        when={writableCalendars().length > 1}
        fallback={
          <Button
            variant="outline"
            size="xs"
            disabled={copy.isPending || writableCalendars().length === 0}
            onClick={() => addToCalendar(writableCalendars()[0]?.id)}
          >
            <CalendarPlusIcon />
            Add to calendar
          </Button>
        }
      >
        <Dropdown open={menuOpen()} onOpenChange={setMenuOpen}>
          <Dropdown.Trigger
            variant="outline"
            size="xs"
            disabled={copy.isPending}
          >
            <CalendarPlusIcon />
            Add to calendar
            <CaretDownIcon />
          </Dropdown.Trigger>
          <Dropdown.Content blockingBackdrop class="z-nested-action-menu">
            <Dropdown.Group>
              <For each={writableCalendars()}>
                {(calendar) => (
                  <Dropdown.Item onSelect={() => addToCalendar(calendar.id)}>
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate">{calendar.name}</span>
                      <Show when={calendar.name !== calendar.emailAddress}>
                        <span class="truncate text-xs text-ink-muted">
                          {calendar.emailAddress}
                        </span>
                      </Show>
                    </span>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </Show>
      <Button
        variant="ghost"
        size="xs"
        disabled={download.isPending}
        onClick={() => download.mutate(props.eventId)}
      >
        <DownloadIcon />
        Download .ics
      </Button>
    </div>
  );
}
