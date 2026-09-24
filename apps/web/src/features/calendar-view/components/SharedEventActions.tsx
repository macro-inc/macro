import { useHoldParentHoverCardOpen } from '@core/component/HoverCard';
import { toast } from '@core/component/Toast/Toast';
import CalendarPlusIcon from '@phosphor/calendar-plus.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import DownloadIcon from '@phosphor/download-simple.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  useCopySharedCalendarEventMutation,
  useDownloadCalendarEventIcsMutation,
} from '@queries/calendar/mutations';
import { Button, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';

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
 * of their channels: add a private copy to one of their calendars, or
 * download it for a calendar Macro does not write to.
 */
export function SharedEventActions(props: { eventId: string; title: string }) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  // The calendar menu portals out of the hover card; keep the card open
  // while the viewer picks a calendar.
  useHoldParentHoverCardOpen(menuOpen);

  const calendars = useVisibleCalendarsQuery();
  const writableCalendars = () =>
    (calendars.data ?? []).filter((calendar) => calendar.isWritable);

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

  const download = useDownloadCalendarEventIcsMutation({
    onSuccess: (document) => {
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(document)], { type: 'text/calendar' })
      );
      const link = window.document.createElement('a');
      link.href = url;
      link.download = icsFileName(props.title);
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: () => toast.failure('Failed to download the event'),
  });

  return (
    <div
      class="mt-1 flex flex-wrap items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
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
